"""Route definitions."""

from flask import Blueprint

bp = Blueprint("api", __name__)


@bp.route("/users")
def list_users():
    return {"users": []}


@bp.route("/users/<int:uid>")
def get_user(uid):
    return {"user": uid}
