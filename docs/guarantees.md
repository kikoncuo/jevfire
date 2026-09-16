# Fixed fields, finite values

> The model cannot invent output fields or values outside the supplied choices.
> It scores candidates; application code builds the result.

This claim applies to the successful `parsed_json` decision payload, not every
piece of response metadata. Its field names come directly from the accepted
request schema. Each value comes from that field's allowed values, or is `null`
when the caller has enabled abstention and the threshold is not met.

The model's generated text is not parsed as JSON and cannot add fields. For
example, if the schema allows only `maneuver: [brake, coast, accelerate]` and
`boost: boolean`, model text saying `{"teleport": true}` cannot introduce a
`teleport` key. That text is ignored; the implementation reads only the requested
label scores and constructs the two declared fields.

| By construction | Still requires evaluation or application policy |
|:--|:--|
| Exactly the supplied decision keys | Whether a selected value is factually correct |
| Only declared enums/booleans, plus opted-in abstention | Whether independent values form a coherent joint action |
| Application-serialized valid JSON on success | Whether supplied context is truthful or complete |
| Missing/nonfinite scores fail explicitly | Whether prompting, label order or injected text changes the chosen value |

**Do not describe JEVfire as “hallucination-free.”** It eliminates model-invented
schema fields and out-of-set values in this API path. It does not eliminate
incorrect classifications, prompt-influenced choices, or erroneous actions.
An allowed `accelerate` value can still be a bad driving decision.

The request itself is application-controlled. If the caller supplies a new
field, it becomes part of the schema; this is not a model-created field. A
gateway should validate which schemas and actions its clients may request.
Neither type safety nor a high relative label probability grants tool permissions.

Fixed nested objects and arrays can be assembled in application code with the
same structural property. The current inference API does not infer arbitrary
nested structure or dynamic array lengths.

The browser squad demo applies the same construction in JavaScript. It also
validates the completed action object before using it and applies deterministic
game rules. The CUDA sidecar and browser runtime have different scheduling
and caching behavior; the structural contract does not depend on those speed
optimizations.
