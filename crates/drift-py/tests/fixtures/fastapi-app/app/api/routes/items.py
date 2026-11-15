from typing import Any

from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser, SessionDep, WriteItems
from app.models import Item, ItemCreate

router = APIRouter(prefix="/items", tags=["items"])


@router.get("/", response_model=list[Item])
def read_items(session: SessionDep, user: CurrentUser, skip: int = 0) -> Any:
    return session.exec(skip)


@router.post("/{item_id}", response_model=Item, status_code=201)
async def update_item(auth: WriteItems, session: SessionDep, item_id: int, body: ItemCreate) -> Any:
    item = Item.model_validate(body)
    if item is None:
        raise HTTPException(status_code=404, detail="not found")
    await session.commit()
    return item


@router.api_route("/{item_id}/sync", methods=["PUT", "PATCH"])
def sync_item(session: SessionDep, item_id: int) -> Any:
    return item_id


def _helper() -> None:
    pass
