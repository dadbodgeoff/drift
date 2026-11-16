import os

from ninja.security import APIKeyHeader


class ApiKey(APIKeyHeader):
    param_name = "X-API-Key"

    def authenticate(self, request, key):
        if key == os.environ.get("API_KEY"):
            return key
        return None
