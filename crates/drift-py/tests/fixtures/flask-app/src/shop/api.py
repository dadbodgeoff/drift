from flask import Blueprint
from flask_restx import Api, Namespace, Resource

from shop.auth import admins_only

api_bp = Blueprint("api", __name__, url_prefix="/api/v1")
api = Api(api_bp)
users = Namespace("users")
api.add_namespace(users, "/people")


@users.route("/<int:user_id>")
class UserResource(Resource):
    def get(self, user_id: int) -> dict:
        return {"id": user_id}

    @admins_only
    def delete(self, user_id: int) -> None:
        return None
