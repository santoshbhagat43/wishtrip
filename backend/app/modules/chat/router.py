import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai.orchestrator import AIOrchestrator, get_orchestrator
from app.core.deps import get_current_user
from app.core.errors import not_found
from app.db.session import get_session
from app.modules.chat import pipeline
from app.modules.chat.models import ChatMessage, ChatSession, MessageRole
from app.modules.chat.schemas import ChatTurn, MessageCreate, SessionDetail, SessionRead
from app.modules.creators import service as creators
from app.modules.users.models import Role, User

router = APIRouter(prefix="/chat", tags=["chat"])


async def _own_session(session: AsyncSession, chat_id: uuid.UUID, user: User) -> ChatSession:
    chat = await session.scalar(
        select(ChatSession)
        .where(ChatSession.id == chat_id)
        .options(selectinload(ChatSession.messages))
    )
    if not chat or (chat.user_id != user.id and user.role != Role.ADMIN):
        raise not_found("Chat")
    return chat


@router.get("/sessions", response_model=list[SessionRead])
async def list_sessions(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    rows = await session.scalars(
        select(ChatSession)
        .where(ChatSession.user_id == user.id)
        .order_by(ChatSession.updated_at.desc())
    )
    return list(rows)


@router.post("/sessions", response_model=SessionRead, status_code=201)
async def create_session(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
):
    chat = ChatSession(user_id=user.id, state={})
    session.add(chat)
    await session.commit()
    await session.refresh(chat)
    return chat


@router.get("/sessions/{chat_id}", response_model=SessionDetail)
async def get_chat(
    chat_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return await _own_session(session, chat_id, user)


@router.delete("/sessions/{chat_id}", status_code=204)
async def delete_chat(
    chat_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    await session.delete(await _own_session(session, chat_id, user))
    await session.commit()
    return Response(status_code=204)


@router.post("/sessions/{chat_id}/messages", response_model=ChatTurn)
async def send_message(
    chat_id: uuid.UUID,
    data: MessageCreate,
    session: AsyncSession = Depends(get_session),
    ai: AIOrchestrator = Depends(get_orchestrator),
    user: User = Depends(get_current_user),
):
    chat = await _own_session(session, chat_id, user)
    history = [{"role": m.role.value, "content": m.content} for m in chat.messages]

    # Stamp each message when it happens. The database default is the transaction's start
    # time, which would give the question and its answer the same timestamp — and the
    # conversation no order between them.
    user_message = ChatMessage(
        session_id=chat.id,
        role=MessageRole.USER,
        content=data.content,
        created_at=datetime.now(UTC),
    )
    session.add(user_message)
    if not chat.messages:
        chat.title = data.content[:80]

    result = await pipeline.run(session, ai, chat, user.id, data.content, history)
    assistant = ChatMessage(
        session_id=chat.id,
        role=MessageRole.ASSISTANT,
        created_at=datetime.now(UTC),
        content=result.content,
        intent=result.intent.to_dict(),
        grounding=result.grounding,
        suggestions=result.suggestions,
        sources=result.sources,
        follow_ups=result.follow_ups,
        validation_notes=result.validation_notes,
        itinerary=result.itinerary,
        feasibility=result.feasibility,
        model=result.model,
        debug=result.debug,
    )
    session.add(assistant)
    if (code := chat.state.get("my_trip")) and result.suggestions:
        # A chat opened from a trip board changes that board.
        from app.modules.creators import mine

        if pipeline.wants_plan(result.intent):
            await mine.sync_from_chat(session, str(code), result.suggestions)
    if result.suggestions and pipeline.wants_plan(result.intent):
        # A credited traveller's first plan earns their creator a commission.
        await creators.record_trip_planned(session, user)
    await session.commit()
    for obj in (chat, user_message, assistant):
        await session.refresh(obj)
    return ChatTurn(session=chat, user_message=user_message, assistant_message=assistant)
