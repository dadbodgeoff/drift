from ninja import Router, Schema

router = Router()


class ItemIn(Schema):
    name: str


@router.get("/{item_id}")
def show(request, item_id: int):
    return {"id": item_id}


@router.post("/", auth=None)
def create(request, payload: ItemIn):
    return {"name": payload.name}
