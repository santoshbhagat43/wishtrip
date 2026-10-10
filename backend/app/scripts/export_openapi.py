"""Write the OpenAPI schema for the dashboard's typed client.

uv run python -m app.scripts.export_openapi ../dashboard/src/lib/api/openapi.json
"""

import json
import sys
from pathlib import Path

from app.main import app

Path(sys.argv[1]).write_text(json.dumps(app.openapi(), indent=1))
