from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import logging
import bcrypt
import jwt
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, Field
from typing import List, Optional

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'iona_os')]

JWT_SECRET = os.environ.get('JWT_SECRET', secrets.token_hex(32))
JWT_ALGORITHM = "HS256"

app = FastAPI(title="IONA OS API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ─── Helpers ───
def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_pin(pin: str, hashed: str) -> bool:
    return bcrypt.checkpw(pin.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, minutes: int = 1440) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(minutes=minutes)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["id"] = str(user["_id"])
        del user["_id"]
        user.pop("pin_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except (jwt.InvalidTokenError, Exception):
        raise HTTPException(status_code=401, detail="Invalid token")

# ─── Models ───
class RegisterInput(BaseModel):
    username: str
    pin: str

class LoginInput(BaseModel):
    username: str
    pin: str

class ContactInput(BaseModel):
    name: str
    phone: str
    avatar_color: str = "#FF4B00"

class MessageInput(BaseModel):
    contact_id: str
    text: str
    direction: str = "sent"

class CallInput(BaseModel):
    contact_name: str
    phone: str
    call_type: str = "outgoing"
    duration_seconds: int = 0

class SendTokenInput(BaseModel):
    to_address: str
    amount: float

class SettingsInput(BaseModel):
    wifi_enabled: bool = True
    mobile_data: bool = True
    bluetooth: bool = False
    brightness: int = 80
    volume: int = 70
    notifications: bool = True
    do_not_disturb: bool = False
    auto_brightness: bool = True
    battery_saver: bool = False
    firewall: bool = True

# ─── Auth ───
@api.post("/auth/register")
async def register(inp: RegisterInput):
    if len(inp.pin) < 4:
        raise HTTPException(400, "PIN must be at least 4 digits")
    existing = await db.users.find_one({"username": inp.username})
    if existing:
        raise HTTPException(400, "Username already exists")
    user_doc = {
        "username": inp.username,
        "pin_hash": hash_pin(inp.pin),
        "wallet_address": f"iona1{secrets.token_hex(20)}",
        "wallet_balance": 12404.50,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    token = create_token(user_id)
    await db.settings.update_one(
        {"user_id": user_id},
        {"$setOnInsert": {
            "user_id": user_id,
            "wifi_enabled": True, "mobile_data": True, "bluetooth": False,
            "brightness": 80, "volume": 70, "notifications": True,
            "do_not_disturb": False, "auto_brightness": True,
            "battery_saver": False, "firewall": True,
        }},
        upsert=True
    )
    return {"token": token, "user": {"id": user_id, "username": inp.username, "wallet_address": user_doc["wallet_address"], "wallet_balance": user_doc["wallet_balance"]}}

@api.post("/auth/login")
async def login(inp: LoginInput):
    user = await db.users.find_one({"username": inp.username})
    if not user or not verify_pin(inp.pin, user["pin_hash"]):
        raise HTTPException(401, "Invalid credentials")
    user_id = str(user["_id"])
    token = create_token(user_id)
    return {"token": token, "user": {"id": user_id, "username": user["username"], "wallet_address": user["wallet_address"], "wallet_balance": user["wallet_balance"]}}

@api.get("/auth/me")
async def me(request: Request):
    user = await get_current_user(request)
    return user

# ─── Contacts ───
@api.get("/contacts")
async def get_contacts(request: Request):
    user = await get_current_user(request)
    contacts = await db.contacts.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    return contacts

@api.post("/contacts")
async def create_contact(inp: ContactInput, request: Request):
    user = await get_current_user(request)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "name": inp.name,
        "phone": inp.phone,
        "avatar_color": inp.avatar_color,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.contacts.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, request: Request):
    user = await get_current_user(request)
    await db.contacts.delete_one({"id": contact_id, "user_id": user["id"]})
    return {"ok": True}

# ─── Messages ───
@api.get("/messages")
async def get_conversations(request: Request):
    user = await get_current_user(request)
    messages = await db.messages.find({"user_id": user["id"]}, {"_id": 0}).sort("timestamp", -1).to_list(1000)
    convos = {}
    for m in messages:
        cid = m["contact_id"]
        if cid not in convos:
            convos[cid] = {"contact_id": cid, "contact_name": m.get("contact_name", "Unknown"), "last_message": m["text"], "last_time": m["timestamp"], "unread": 0}
        if m.get("direction") == "received" and not m.get("read"):
            convos[cid]["unread"] += 1
    return list(convos.values())

@api.get("/messages/{contact_id}")
async def get_messages(contact_id: str, request: Request):
    user = await get_current_user(request)
    msgs = await db.messages.find({"user_id": user["id"], "contact_id": contact_id}, {"_id": 0}).sort("timestamp", 1).to_list(500)
    return msgs

@api.post("/messages")
async def send_message(inp: MessageInput, request: Request):
    user = await get_current_user(request)
    contact = await db.contacts.find_one({"id": inp.contact_id, "user_id": user["id"]}, {"_id": 0})
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "contact_id": inp.contact_id,
        "contact_name": contact["name"] if contact else "Unknown",
        "text": inp.text,
        "direction": inp.direction,
        "read": True if inp.direction == "sent" else False,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.messages.insert_one(doc)
    doc.pop("_id", None)
    return doc

# ─── Calls ───
@api.get("/calls")
async def get_calls(request: Request):
    user = await get_current_user(request)
    calls = await db.calls.find({"user_id": user["id"]}, {"_id": 0}).sort("timestamp", -1).to_list(200)
    return calls

@api.post("/calls")
async def create_call(inp: CallInput, request: Request):
    user = await get_current_user(request)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "contact_name": inp.contact_name,
        "phone": inp.phone,
        "call_type": inp.call_type,
        "duration_seconds": inp.duration_seconds,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.calls.insert_one(doc)
    doc.pop("_id", None)
    return doc

# ─── Wallet / Blockchain ───
@api.get("/wallet")
async def get_wallet(request: Request):
    user = await get_current_user(request)
    full_user = await db.users.find_one({"_id": ObjectId(user["id"])}, {"_id": 0, "pin_hash": 0})
    txs = await db.transactions.find({"user_id": user["id"]}, {"_id": 0}).sort("timestamp", -1).to_list(100)
    return {
        "address": full_user.get("wallet_address", ""),
        "balance": full_user.get("wallet_balance", 0),
        "transactions": txs
    }

@api.post("/wallet/send")
async def send_tokens(inp: SendTokenInput, request: Request):
    user = await get_current_user(request)
    if inp.amount <= 0:
        raise HTTPException(400, "Amount must be positive")
    full_user = await db.users.find_one({"_id": ObjectId(user["id"])})
    if full_user["wallet_balance"] < inp.amount:
        raise HTTPException(400, "Insufficient balance")
    new_balance = full_user["wallet_balance"] - inp.amount
    await db.users.update_one({"_id": ObjectId(user["id"])}, {"$set": {"wallet_balance": new_balance}})
    tx = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "tx_hash": f"0x{secrets.token_hex(32)}",
        "from_address": full_user["wallet_address"],
        "to_address": inp.to_address,
        "amount": inp.amount,
        "status": "confirmed",
        "block_height": 849002 + int(datetime.now(timezone.utc).timestamp()) % 1000,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await db.transactions.insert_one(tx)
    tx.pop("_id", None)
    return {"balance": new_balance, "transaction": tx}

@api.get("/blockchain/nodes")
async def get_nodes(request: Request):
    await get_current_user(request)
    nodes = [
        {"id": "node-alpha", "name": "IONA Node Alpha", "status": "ok", "version": "0.6.0", "height": 849002, "peers": 12, "sync_status": "synced", "uptime_ms": 3600000 * 24 * 7, "mem_used_kb": 65536, "mem_total_kb": 262144, "degraded": False, "ip": "10.10.0.10", "port": 9000},
        {"id": "node-beta", "name": "IONA Node Beta", "status": "ok", "version": "0.6.0", "height": 849001, "peers": 11, "sync_status": "synced", "uptime_ms": 3600000 * 24 * 5, "mem_used_kb": 58320, "mem_total_kb": 262144, "degraded": False, "ip": "10.10.0.11", "port": 9000},
        {"id": "node-gamma", "name": "IONA Node Gamma", "status": "syncing", "version": "0.6.0", "height": 848990, "peers": 8, "sync_status": "syncing", "uptime_ms": 3600000 * 2, "mem_used_kb": 72000, "mem_total_kb": 262144, "degraded": False, "ip": "10.10.0.12", "port": 9000},
        {"id": "node-delta", "name": "IONA Node Delta", "status": "degraded", "version": "0.6.0", "height": 848500, "peers": 3, "sync_status": "degraded", "uptime_ms": 3600000, "mem_used_kb": 120000, "mem_total_kb": 262144, "degraded": True, "ip": "10.10.0.13", "port": 9000},
    ]
    return {
        "network": "IONA Testnet",
        "consensus": "Tendermint BFT",
        "total_nodes": len(nodes),
        "healthy_nodes": sum(1 for n in nodes if n["status"] == "ok"),
        "current_height": 849002,
        "nodes": nodes
    }

@api.get("/blockchain/status")
async def blockchain_status(request: Request):
    await get_current_user(request)
    return {
        "network": "IONA Mainnet",
        "consensus": "Tendermint BFT",
        "block_height": 849002,
        "total_validators": 4,
        "active_validators": 3,
        "total_supply": "1000000000 IONA",
        "tps": 1200,
        "finality": "< 1s",
        "kernel_version": "0.6.0"
    }

# ─── Settings ───
@api.get("/settings")
async def get_settings(request: Request):
    user = await get_current_user(request)
    settings = await db.settings.find_one({"user_id": user["id"]}, {"_id": 0})
    if not settings:
        settings = {"user_id": user["id"], "wifi_enabled": True, "mobile_data": True, "bluetooth": False, "brightness": 80, "volume": 70, "notifications": True, "do_not_disturb": False, "auto_brightness": True, "battery_saver": False, "firewall": True}
    return settings

@api.put("/settings")
async def update_settings(inp: SettingsInput, request: Request):
    user = await get_current_user(request)
    await db.settings.update_one({"user_id": user["id"]}, {"$set": inp.dict()}, upsert=True)
    return {"ok": True}

# ─── Startup / Seed ───
@app.on_event("startup")
async def startup():
    await db.users.create_index("username", unique=True)
    await db.contacts.create_index("user_id")
    await db.messages.create_index([("user_id", 1), ("contact_id", 1)])
    await db.calls.create_index("user_id")
    await db.transactions.create_index("user_id")

    existing = await db.users.find_one({"username": "iona"})
    if not existing:
        user_doc = {
            "username": "iona",
            "pin_hash": hash_pin("1234"),
            "wallet_address": f"iona1{secrets.token_hex(20)}",
            "wallet_balance": 12404.50,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        result = await db.users.insert_one(user_doc)
        uid = str(result.inserted_id)

        # Seed contacts (English names)
        contacts = [
            {"id": str(uuid.uuid4()), "user_id": uid, "name": "Alex Carter", "phone": "+1 555 100 2001", "avatar_color": "#FF4B00", "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "user_id": uid, "name": "Sarah Blake", "phone": "+1 555 100 2002", "avatar_color": "#00FF41", "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "user_id": uid, "name": "James Reeves", "phone": "+1 555 100 2003", "avatar_color": "#3B82F6", "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "user_id": uid, "name": "Nina Walsh", "phone": "+1 555 100 2004", "avatar_color": "#A855F7", "created_at": datetime.now(timezone.utc).isoformat()},
            {"id": str(uuid.uuid4()), "user_id": uid, "name": "IONA Support", "phone": "+1 800 100 1000", "avatar_color": "#FF4B00", "created_at": datetime.now(timezone.utc).isoformat()},
        ]
        await db.contacts.insert_many(contacts)

        # Seed messages (English)
        for c in contacts[:3]:
            msgs = [
                {"id": str(uuid.uuid4()), "user_id": uid, "contact_id": c["id"], "contact_name": c["name"], "text": "Hey! Have you checked the IONA node?", "direction": "received", "read": True, "timestamp": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()},
                {"id": str(uuid.uuid4()), "user_id": uid, "contact_id": c["id"], "contact_name": c["name"], "text": "Yeah, running great. Block height 849k+", "direction": "sent", "read": True, "timestamp": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()},
            ]
            await db.messages.insert_many(msgs)

        # Seed calls
        call_seeds = [
            {"id": str(uuid.uuid4()), "user_id": uid, "contact_name": "Alex Carter", "phone": "+1 555 100 2001", "call_type": "incoming", "duration_seconds": 185, "timestamp": (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()},
            {"id": str(uuid.uuid4()), "user_id": uid, "contact_name": "Sarah Blake", "phone": "+1 555 100 2002", "call_type": "outgoing", "duration_seconds": 42, "timestamp": (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()},
            {"id": str(uuid.uuid4()), "user_id": uid, "contact_name": "James Reeves", "phone": "+1 555 100 2003", "call_type": "missed", "duration_seconds": 0, "timestamp": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()},
        ]
        await db.calls.insert_many(call_seeds)

        # Seed transactions
        txs = [
            {"id": str(uuid.uuid4()), "user_id": uid, "tx_hash": f"0x{secrets.token_hex(32)}", "from_address": "iona1abc...def", "to_address": user_doc["wallet_address"], "amount": 500.0, "status": "confirmed", "block_height": 849000, "timestamp": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()},
            {"id": str(uuid.uuid4()), "user_id": uid, "tx_hash": f"0x{secrets.token_hex(32)}", "from_address": user_doc["wallet_address"], "to_address": "iona1xyz...789", "amount": 100.0, "status": "confirmed", "block_height": 848990, "timestamp": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()},
        ]
        await db.transactions.insert_many(txs)

        # Seed settings
        await db.settings.insert_one({"user_id": uid, "wifi_enabled": True, "mobile_data": True, "bluetooth": False, "brightness": 80, "volume": 70, "notifications": True, "do_not_disturb": False, "auto_brightness": True, "battery_saver": False, "firewall": True})

        logger.info("Seeded default user 'iona' with PIN '1234'")

    os.makedirs("/app/memory", exist_ok=True)
    with open("/app/memory/test_credentials.md", "w") as f:
        f.write("# IONA OS Test Credentials\n\n")
        f.write("## Default User\n")
        f.write("- Username: iona\n")
        f.write("- PIN: 1234\n\n")
        f.write("## Auth Endpoints\n")
        f.write("- POST /api/auth/register (username, pin)\n")
        f.write("- POST /api/auth/login (username, pin)\n")
        f.write("- GET /api/auth/me (Bearer token)\n")

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown():
    client.close()
