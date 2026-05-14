"""
IONA OS Backend API Tests
Tests for: Auth, Contacts, Messages, Calls, Wallet, Blockchain Nodes, Settings
"""
import pytest
import requests

class TestAuth:
    """Authentication endpoint tests"""

    def test_login_success(self, api_client, base_url):
        """Test login with correct credentials"""
        response = api_client.post(f"{base_url}/api/auth/login", json={
            "username": "iona",
            "pin": "1234"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        
        data = response.json()
        assert "token" in data, "Token missing in response"
        assert "user" in data, "User missing in response"
        assert data["user"]["username"] == "iona"
        assert data["user"]["wallet_balance"] == 12404.50
        assert "wallet_address" in data["user"]
        print("✓ Login successful with correct credentials")

    def test_login_invalid_pin(self, api_client, base_url):
        """Test login with wrong PIN"""
        response = api_client.post(f"{base_url}/api/auth/login", json={
            "username": "iona",
            "pin": "9999"
        })
        assert response.status_code == 401, "Should reject invalid PIN"
        print("✓ Invalid PIN rejected correctly")

    def test_auth_me(self, api_client, base_url, auth_headers):
        """Test /api/auth/me endpoint"""
        response = api_client.get(f"{base_url}/api/auth/me", headers=auth_headers)
        assert response.status_code == 200, f"Auth me failed: {response.text}"
        
        user = response.json()
        assert user["username"] == "iona"
        assert "wallet_balance" in user
        print("✓ Auth me endpoint working")


class TestContacts:
    """Contacts CRUD tests"""

    def test_get_contacts(self, api_client, base_url, auth_headers):
        """Test fetching contacts list"""
        response = api_client.get(f"{base_url}/api/contacts", headers=auth_headers)
        assert response.status_code == 200, f"Get contacts failed: {response.text}"
        
        contacts = response.json()
        assert isinstance(contacts, list), "Contacts should be a list"
        assert len(contacts) >= 5, "Should have at least 5 seeded contacts"
        
        # Verify seeded contacts
        names = [c["name"] for c in contacts]
        assert "Alex Popescu" in names
        assert "Maria Ionescu" in names
        assert "IONA Support" in names
        print(f"✓ Got {len(contacts)} contacts")

    def test_create_contact(self, api_client, base_url, auth_headers):
        """Test creating a new contact"""
        new_contact = {
            "name": "TEST_John Doe",
            "phone": "+40 799 999 999",
            "avatar_color": "#FF0000"
        }
        response = api_client.post(f"{base_url}/api/contacts", json=new_contact, headers=auth_headers)
        assert response.status_code == 200, f"Create contact failed: {response.text}"
        
        contact = response.json()
        assert contact["name"] == new_contact["name"]
        assert contact["phone"] == new_contact["phone"]
        assert "id" in contact
        print(f"✓ Created contact: {contact['name']}")


class TestMessages:
    """Messages endpoint tests"""

    def test_get_conversations(self, api_client, base_url, auth_headers):
        """Test fetching conversation list"""
        response = api_client.get(f"{base_url}/api/messages", headers=auth_headers)
        assert response.status_code == 200, f"Get conversations failed: {response.text}"
        
        convos = response.json()
        assert isinstance(convos, list), "Conversations should be a list"
        assert len(convos) >= 3, "Should have at least 3 seeded conversations"
        
        # Verify conversation structure
        if convos:
            c = convos[0]
            assert "contact_id" in c
            assert "contact_name" in c
            assert "last_message" in c
            assert "last_time" in c
        print(f"✓ Got {len(convos)} conversations")

    def test_get_messages_for_contact(self, api_client, base_url, auth_headers):
        """Test fetching messages for a specific contact"""
        # First get contacts to get a contact_id
        contacts_resp = api_client.get(f"{base_url}/api/contacts", headers=auth_headers)
        contacts = contacts_resp.json()
        
        if contacts:
            contact_id = contacts[0]["id"]
            response = api_client.get(f"{base_url}/api/messages/{contact_id}", headers=auth_headers)
            assert response.status_code == 200, f"Get messages failed: {response.text}"
            
            messages = response.json()
            assert isinstance(messages, list), "Messages should be a list"
            print(f"✓ Got {len(messages)} messages for contact")


class TestCalls:
    """Call history tests"""

    def test_get_calls(self, api_client, base_url, auth_headers):
        """Test fetching call history"""
        response = api_client.get(f"{base_url}/api/calls", headers=auth_headers)
        assert response.status_code == 200, f"Get calls failed: {response.text}"
        
        calls = response.json()
        assert isinstance(calls, list), "Calls should be a list"
        assert len(calls) >= 3, "Should have at least 3 seeded calls"
        
        # Verify call structure
        if calls:
            call = calls[0]
            assert "contact_name" in call
            assert "phone" in call
            assert "call_type" in call
            assert "duration_seconds" in call
            assert call["call_type"] in ["incoming", "outgoing", "missed"]
        print(f"✓ Got {len(calls)} call records")


class TestWallet:
    """Wallet and blockchain tests"""

    def test_get_wallet(self, api_client, base_url, auth_headers):
        """Test fetching wallet data"""
        response = api_client.get(f"{base_url}/api/wallet", headers=auth_headers)
        assert response.status_code == 200, f"Get wallet failed: {response.text}"
        
        wallet = response.json()
        assert "address" in wallet
        assert "balance" in wallet
        assert "transactions" in wallet
        assert wallet["balance"] == 12404.50, "Initial balance should be 12404.50"
        assert isinstance(wallet["transactions"], list)
        print(f"✓ Wallet balance: {wallet['balance']} IONA")

    def test_get_blockchain_nodes(self, api_client, base_url, auth_headers):
        """Test fetching blockchain nodes (MOCKED)"""
        response = api_client.get(f"{base_url}/api/blockchain/nodes", headers=auth_headers)
        assert response.status_code == 200, f"Get nodes failed: {response.text}"
        
        data = response.json()
        assert "nodes" in data
        assert "network" in data
        assert "total_nodes" in data
        assert data["total_nodes"] == 4, "Should have 4 nodes"
        
        nodes = data["nodes"]
        node_names = [n["name"] for n in nodes]
        assert "IONA Node Alpha" in node_names
        assert "IONA Node Beta" in node_names
        assert "IONA Node Gamma" in node_names
        assert "IONA Node Delta" in node_names
        
        # Verify node structure
        alpha = next(n for n in nodes if n["name"] == "IONA Node Alpha")
        assert alpha["status"] == "ok"
        assert alpha["version"] == "0.6.0"
        assert "height" in alpha
        assert "peers" in alpha
        print(f"✓ Got {len(nodes)} blockchain nodes (MOCKED)")

    def test_get_blockchain_status(self, api_client, base_url, auth_headers):
        """Test fetching blockchain status (MOCKED)"""
        response = api_client.get(f"{base_url}/api/blockchain/status", headers=auth_headers)
        assert response.status_code == 200, f"Get blockchain status failed: {response.text}"
        
        status = response.json()
        assert status["network"] == "IONA Mainnet"
        assert status["consensus"] == "Tendermint BFT"
        assert status["block_height"] == 849002
        assert status["kernel_version"] == "0.6.0"
        print("✓ Blockchain status retrieved (MOCKED)")


class TestSettings:
    """Settings endpoint tests"""

    def test_get_settings(self, api_client, base_url, auth_headers):
        """Test fetching user settings"""
        response = api_client.get(f"{base_url}/api/settings", headers=auth_headers)
        assert response.status_code == 200, f"Get settings failed: {response.text}"
        
        settings = response.json()
        assert "wifi_enabled" in settings
        assert "mobile_data" in settings
        assert "bluetooth" in settings
        assert "brightness" in settings
        assert "volume" in settings
        print("✓ Settings retrieved successfully")

    def test_update_settings(self, api_client, base_url, auth_headers):
        """Test updating settings"""
        new_settings = {
            "wifi_enabled": False,
            "mobile_data": True,
            "bluetooth": True,
            "brightness": 50,
            "volume": 60,
            "notifications": False
        }
        response = api_client.put(f"{base_url}/api/settings", json=new_settings, headers=auth_headers)
        assert response.status_code == 200, f"Update settings failed: {response.text}"
        
        # Verify update persisted
        get_resp = api_client.get(f"{base_url}/api/settings", headers=auth_headers)
        settings = get_resp.json()
        assert settings["wifi_enabled"] == False
        assert settings["bluetooth"] == True
        assert settings["brightness"] == 50
        print("✓ Settings updated and persisted")


class TestUnauthorized:
    """Test endpoints without auth"""

    def test_contacts_without_auth(self, api_client, base_url):
        """Test that protected endpoints require auth"""
        response = api_client.get(f"{base_url}/api/contacts")
        assert response.status_code == 401, "Should reject request without auth"
        print("✓ Protected endpoints require authentication")
