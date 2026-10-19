"""Sign-in codes through Trustsignal (email), and the hardcoded fixed code being gone."""

import json
import logging

import httpx
import pytest

from app.core.config import Settings, settings
from app.modules.auth import otp, trustsignal

KEY = "ts-secret-key-0123456789abcdef"


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "trustsignal_api_key", KEY)
    monkeypatch.setattr(settings, "trustsignal_email_from", "login@wishtrip.test")
    monkeypatch.setattr(settings, "trustsignal_email_template_id", "TPL_OTP_1")
    monkeypatch.setattr(settings, "trustsignal_email_url", "https://eapi.trustsignal.test")
    monkeypatch.setattr(settings, "smtp_host", None)
    otp.set_store(otp.MemoryOtpStore())
    yield
    otp.set_store(None)


def client_answering(status: int, body: dict | None, seen: list | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(status, json=body)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


SUCCESS = {
    "message": "Request process successfully",
    "results": {"email": "a@b.test", "transaction_id": "11903236063918584", "ecost": 1},
    "success": True,
}
KEY_MISSING = {
    "errors": [{"code": "101", "codeMsg": "API_KEY_MISSING", "message": "API Key is required"}],
    "success": False,
}


# The request ---------------------------------------------------------------------------------


async def test_the_code_goes_out_as_the_collections_otp_email_request(configured):
    seen: list[httpx.Request] = []
    http = client_answering(200, SUCCESS, seen)
    transaction = await trustsignal.send_otp_email("priya@creators.example.com", "493021", http)

    assert transaction == "11903236063918584"
    [request] = seen
    assert request.method == "POST"
    assert request.url.host == "eapi.trustsignal.test" and request.url.path == "/v1/otp-email"
    assert request.url.params["api_key"] == KEY  # the way their API takes the key
    body = json.loads(request.content)
    assert body["to"] == "priya@creators.example.com" and body["from"] == "login@wishtrip.test"
    assert body["template_id"] == "TPL_OTP_1" and body["subject"] == "Your WishTrip sign-in code"
    # `evariables` is a JSON *string* of the template's variables, with the code in it.
    variables = json.loads(body["evariables"])
    assert variables["otp"] == "493021" and variables["minutes"] == "10"


async def test_the_template_variable_name_is_configurable(configured, monkeypatch):
    monkeypatch.setattr(settings, "trustsignal_otp_variable", "code")
    seen: list[httpx.Request] = []
    await trustsignal.send_otp_email("a@b.test", "111111", client_answering(200, SUCCESS, seen))
    assert json.loads(json.loads(seen[0].content)["evariables"])["code"] == "111111"


@pytest.mark.parametrize(
    ("status", "body", "code"),
    [
        (400, KEY_MISSING, "API_KEY_MISSING"),
        (200, {"success": False, "errors": [{"code": "7", "message": "bad sender"}]}, "7"),
        (500, None, "500"),
    ],
)
async def test_a_refusal_is_an_error_that_never_contains_the_key(configured, status, body, code):
    with pytest.raises(trustsignal.TrustsignalError) as err:
        await trustsignal.send_otp_email("a@b.test", "123456", client_answering(status, body))
    assert err.value.code == code
    assert KEY not in str(err.value) and "api_key" not in str(err.value)


async def test_a_timeout_is_an_error_too(configured):
    def slow(request):
        raise httpx.ReadTimeout("took too long", request=request)

    http = httpx.AsyncClient(transport=httpx.MockTransport(slow))
    with pytest.raises(trustsignal.TrustsignalError) as err:
        await trustsignal.send_otp_email("a@b.test", "123456", http)
    assert err.value.code == "TIMEOUT" and KEY not in str(err.value)


def test_the_key_in_the_url_is_redacted_from_logs():
    # httpx logs every request URL at INFO, and this API puts the key in the URL.
    record = logging.LogRecord(
        "httpx", logging.INFO, __file__, 1,
        'HTTP Request: %s %s "%s"',
        ("POST", f"https://eapi.trustsignal.io/v1/otp-email?api_key={KEY}&x=1", "HTTP/1.1 200 OK"),
        None,
    )  # fmt: skip
    assert trustsignal.RedactApiKey().filter(record)
    logged = record.getMessage()
    assert KEY not in logged and "api_key=***&x=1" in logged
    # …and the filter is really installed on httpx's logger.
    assert any(isinstance(f, trustsignal.RedactApiKey) for f in logging.getLogger("httpx").filters)


# Sending a sign-in code ------------------------------------------------------------------------


async def test_email_is_live_once_trustsignal_is_set_up(configured):
    assert otp.channel_is_live("email")
    assert not otp.channel_is_live("whatsapp")  # Trustsignal WhatsApp comes later


async def test_a_code_is_sent_through_trustsignal_not_smtp(configured, monkeypatch):
    sent = []

    async def fake_send(to, code, client=None):
        sent.append((to, code))
        return "tx-1"

    def no_smtp(*a, **k):
        raise AssertionError("SMTP must not be used when Trustsignal is configured")

    monkeypatch.setattr(trustsignal, "send_otp_email", fake_send)
    monkeypatch.setattr(otp, "_send_email", no_smtp)
    await otp.issue("email", "priya@creators.example.com")
    [(to, code)] = sent
    assert to == "priya@creators.example.com" and len(code) == 6 and code.isdigit()
    assert await otp.check("email", "priya@creators.example.com", code)
    assert not await otp.check("email", "priya@creators.example.com", code)  # single use


async def test_a_failed_send_stores_no_code_and_allows_an_immediate_retry(
    client, configured, monkeypatch
):
    calls = []

    async def refuses(to, code, client=None):
        calls.append(code)
        raise trustsignal.TrustsignalError("API_KEY_MISSING", "API Key is required")

    monkeypatch.setattr(trustsignal, "send_otp_email", refuses)
    body = {"channel": "email", "email": "retry@creators.example.com"}
    r = await client.post("/auth/creator/request-otp", json=body)
    assert r.status_code == 502 and "couldn't send the code" in r.json()["detail"]
    assert "API_KEY" not in r.text and KEY not in r.text  # nothing about the provider leaks out
    # The code that never arrived can't sign anyone in…
    wrong = await client.post("/auth/creator/verify", json={**body, "code": calls[0]})
    assert wrong.status_code == 400
    # …and the person isn't made to wait the resend window for a code that never came.
    again = await client.post("/auth/creator/request-otp", json=body)
    assert again.status_code == 502 and len(calls) == 2


async def test_when_trustsignal_sends_it_the_person_can_sign_in(client, configured, monkeypatch):
    sent = []

    async def fake_send(to, code, client=None):
        sent.append(code)
        return "tx-1"

    monkeypatch.setattr(trustsignal, "send_otp_email", fake_send)
    body = {"channel": "email", "email": "newcreator@creators.example.com"}
    assert (await client.post("/auth/creator/request-otp", json=body)).status_code == 202
    verified = await client.post("/auth/creator/verify", json={**body, "code": sent[0]})
    assert verified.status_code == 200 and "access_token" in verified.json()


# The hardcoded code is gone --------------------------------------------------------------------


def test_there_is_no_hardcoded_default_code():
    assert Settings.model_fields["creator_dev_otp"].default is None


async def test_with_no_provider_and_no_opt_in_nothing_is_sent_and_nothing_signs_in(
    client, monkeypatch
):
    monkeypatch.setattr(settings, "creator_dev_otp", None)
    monkeypatch.setattr(settings, "smtp_host", None)
    monkeypatch.setattr(settings, "trustsignal_api_key", None)
    r = await client.post("/auth/creator/request-otp", json={"email": "x@creators.example.com"})
    assert r.status_code == 503 and "can't send sign-in codes" in r.json()["detail"]
    for code in ("1234", "000000"):
        v = await client.post(
            "/auth/creator/verify",
            json={"channel": "email", "email": "x@creators.example.com", "code": code},
        )
        assert v.status_code == 400


async def test_whatsapp_codes_are_not_offered_yet_even_with_email_live(
    client, configured, monkeypatch
):
    monkeypatch.setattr(settings, "creator_dev_otp", None)
    r = await client.post(
        "/auth/creator/request-otp", json={"channel": "whatsapp", "phone": "+919876543210"}
    )
    assert r.status_code == 503 and "WhatsApp codes aren't available yet" in r.json()["detail"]
    assert "email" in r.json()["detail"].lower()  # says what to do instead


async def test_the_fixed_code_is_ignored_in_production(client, monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "creator_dev_otp", "1234")  # even if someone sets it there
    monkeypatch.setattr(settings, "smtp_host", None)
    monkeypatch.setattr(settings, "trustsignal_api_key", None)
    assert otp.dev_code() is None
    r = await client.post("/auth/creator/request-otp", json={"email": "p@creators.example.com"})
    assert r.status_code == 503
    v = await client.post(
        "/auth/creator/verify",
        json={"channel": "email", "email": "p@creators.example.com", "code": "1234"},
    )
    assert v.status_code == 400
