from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from app import auth, devices, health
from app.db import close_pool


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    close_pool()


# nginx forwards https://vessel.anoni.net/api/ here; /internal/ is for the host only (see app/health.py). No access log is kept for these requests (#433).
app = FastAPI(title="Vessel", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(health.router)


@app.exception_handler(HTTPException)
def http_error(_, exc: HTTPException) -> JSONResponse:
    # errors are {"error": "<code>"}; the frontend turns the code into text in the reader's language
    detail = exc.detail if isinstance(exc.detail, dict) else {"error": str(exc.detail)}
    return JSONResponse(detail, status_code=exc.status_code, headers={"Cache-Control": "no-store"})


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}
