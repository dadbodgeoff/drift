export const addOne = (n: number) => n + 1;

export class Widget {
  build() {
    return addOne(1);
  }
}

export interface WidgetShape {
  id: string;
}

function internalHelper() {
  return addOne(2);
}

export { internalHelper };
