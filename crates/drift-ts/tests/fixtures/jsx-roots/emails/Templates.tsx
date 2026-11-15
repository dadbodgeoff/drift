import React from "react";

import { Wrapper } from "./Wrapper";

// A concise arrow body: the root JSX is the body itself.
export const Concise = ({ name }: { name: string }) => (
  <Wrapper>
    <p>{name}</p>
  </Wrapper>
);

// The same without parentheses.
export const Bare = () => <Wrapper>hi</Wrapper>;

// A block body that returns the root JSX.
export const Block = () => {
  return <Wrapper>hi</Wrapper>;
};

// Rendered inside, not at the root: not wrapped.
export const Nested = () => (
  <section>
    <Wrapper>hi</Wrapper>
  </section>
);

// A function whose only statement is a JSX expression returns nothing: not wrapped.
export function Discarded() {
  <Wrapper>hi</Wrapper>;
}

export default () => (
  <Wrapper>
    <p>default</p>
  </Wrapper>
);
