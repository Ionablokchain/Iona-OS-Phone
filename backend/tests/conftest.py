import pytest
import requests
import os

@pytest.fixture(scope="session")
def api_client():
    """Shared requests session for API testing"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session

@pytest.fixture(scope="session")
def base_url():
    """Base URL from environment"""
    url = os.environ.get('EXPO_PUBLIC_BACKEND_URL')
    if not url:
        pytest.fail("EXPO_PUBLIC_BACKEND_URL not set in environment")
    return url.rstrip('/')

@pytest.fixture(scope="session")
def auth_token(api_client, base_url):
    """Login and return auth token for test user"""
    response = api_client.post(f"{base_url}/api/auth/login", json={
        "username": "iona",
        "pin": "1234"
    })
    if response.status_code != 200:
        pytest.fail(f"Failed to login test user: {response.status_code} {response.text}")
    data = response.json()
    return data["token"]

@pytest.fixture
def auth_headers(auth_token):
    """Headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}"}
