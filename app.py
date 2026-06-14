import os
from datetime import datetime, timezone

from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv

try:
    import google.generativeai as genai
    from google.api_core.exceptions import GoogleAPIError, InvalidArgument
except ImportError:  # pragma: no cover - handled during startup if dependency is missing
    genai = None
    GoogleAPIError = Exception
    InvalidArgument = Exception

load_dotenv()

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
app.config["TEMPLATES_AUTO_RELOAD"] = True

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
SYSTEM_PROMPT = (
    "You are SmartAssist, a helpful, concise AI assistant embedded in a local chat application. "
    "Be accurate, polite, and format technical answers clearly. "
    "If you provide code, keep it readable and minimal."
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_system_instruction() -> str:
    current_utc = _utc_now_iso()
    return (
        f"{SYSTEM_PROMPT} "
        f"Current server time (UTC): {current_utc}. "
        "When the user asks for the current date or time, answer using this server time and do not guess."
    )


def _configure_gemini() -> None:
    if genai is None:
        raise RuntimeError(
            "The google-generativeai package is not installed. Run pip install -r requirements.txt."
        )
    if not GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY is missing. Add it to your .env file before starting the app."
        )
    genai.configure(api_key=GEMINI_API_KEY)


def _normalize_history(history_payload):
    normalized = []
    if not isinstance(history_payload, list):
        return normalized

    for entry in history_payload:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        content = entry.get("content")
        if role not in {"user", "assistant"}:
            continue
        if not isinstance(content, str) or not content.strip():
            continue
        normalized.append({"role": role, "content": content.strip()})
    return normalized


def _build_gemini_contents(history):
    contents = []
    for message in history:
        role = "user" if message["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": message["content"]}]})
    return contents


@app.route("/")
def index():
    return render_template(
        "index.html",
        gemini_model=GEMINI_MODEL,
        api_ready=bool(GEMINI_API_KEY),
    )


@app.route("/api/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "timestamp": _utc_now_iso(),
            "api_ready": bool(GEMINI_API_KEY),
            "model": GEMINI_MODEL,
        }
    )


@app.route("/api/chat", methods=["POST"])
def chat():
    payload = request.get_json(silent=True) or {}
    message = payload.get("message", "")
    history = _normalize_history(payload.get("history", []))

    if not isinstance(message, str) or not message.strip():
        return jsonify({"error": "Message is required."}), 400

    if not GEMINI_API_KEY:
        return (
            jsonify(
                {
                    "error": "GEMINI_API_KEY is not configured. Add it to your .env file and restart the server.",
                }
            ),
            500,
        )

    try:
        _configure_gemini()
        model = genai.GenerativeModel(
            model_name=GEMINI_MODEL,
            system_instruction=_build_system_instruction(),
        )

        chat_contents = _build_gemini_contents(history)
        chat_contents.append({"role": "user", "parts": [{"text": message.strip()}]})

        response = model.generate_content(
            chat_contents,
            generation_config={
                "temperature": 0.7,
                "top_p": 0.95,
                "top_k": 40,
                "max_output_tokens": 1024,
            },
        )

        reply_text = getattr(response, "text", None)
        if not reply_text:
            reply_text = "I could not generate a response. Please try again."

        return jsonify(
            {
                "reply": reply_text,
                "model": GEMINI_MODEL,
                "timestamp": _utc_now_iso(),
            }
        )
    except (GoogleAPIError, InvalidArgument) as exc:
        app.logger.exception("Gemini API error")
        return (
            jsonify({"error": "Gemini API request failed.", "details": str(exc)}),
            502,
        )
    except Exception as exc:  # noqa: BLE001 - surface a friendly API error
        app.logger.exception("Unexpected chat error")
        return (
            jsonify({"error": "An unexpected error occurred while processing the chat request.", "details": str(exc)}),
            500,
        )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
