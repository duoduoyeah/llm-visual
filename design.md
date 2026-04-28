

here this folder will get this format of file:

the file has items:
token item that include:
what's vocab id, this means what this token semantic is
what's the token id, this is identity for each token item, same vocab id could has more than one tokens in one sequence, so yes,
sequence, the parent sequence is what.
which step it is generated, step 0 means prompt
which step it is input to the model, could be one step or many step, since some model will input the token again and again, when there is no immediate kv cache]
the position of this token, this will be two ways: one is to give a abs position index, another is that we will use a special method, that it will show two tokens id, then this token will be between these two tokens; in this way, there is a time stuff, that suppose below:

step 0 a,b
step 1, a, c, b; here the c is generated in step 1, and the position id is [a,b] means this token is between a and b
step 2, a,c,d,b; here the d is generated in step 2, and it position is [c,b] means it is in c and b;

so in this second method, the final position will determine by both abs id and the step stuff.

## Constraints on the relative-position scheme

- Anchors `a` and `b` must both be tokens generated in strictly earlier steps (not the current step).
- Per step, at most one new token per anchor pair `[a, b]`. If violated, the renderer errors: `step N: multiple tokens claim position [a, b]: <token_ids>`.

## Layout: signed permanent columns

For `abs`-positioned tokens, the column is **permanent** — fixed at the step the token is generated. Any signed integer is allowed:

- Forward autoregressive: `abs: 0, 1, 2, …`
- Reverse / right-to-left LM: `abs: 0, -1, -2, …` (left-end growth)
- Mixed layouts: any integer

The renderer computes `offset = -min(abs over all tokens)` and renders each token at pixel column `abs + offset`. Two tokens with the same `abs` are an error.

For `between`-positioned tokens (speculative/tree decoding), column is derived as the midpoint of the two anchor columns. Neighboring between-tokens slide aside with a ~150ms transition when something is inserted between them. `abs`-positioned tokens never slide.

## Animation

- Slider scrubs by step. When stopped on step N:
  - past (`gen_step < N`): solid, grayscale ramp (light → dark with step).
  - current (`gen_step == N`): warm orange accent.
  - next (`gen_step == N+1`): ghosted at ~30% opacity in its eventual color.
  - beyond (`gen_step > N+1`): hidden.
- Mid-sequence `between` insertions slide neighboring tokens right with a ~150ms transition (no jumps).
