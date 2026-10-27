from fastapi import FastAPI

# nginx forwards https://vessel.anoni.net/api/ here. No access log is kept for these requests (#433).
app = FastAPI(title="Vessel", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}
