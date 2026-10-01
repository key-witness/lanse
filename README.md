# L'ANSE

Stories from the low places, taken down as they were told.

A dependency-free literary text game with an optional, low-cost narrative
director. The authored passage graph remains canonical. At two meaningful
beats, the director selects one authored thematic reflection from a strict
enum using only compact choice signals. Names and free-text answers remain in
the browser.

## Cost controls

- At most two AI decisions per saved reading
- 120 output-token ceiling per request
- Four uncached requests per IP per hour
- Browser-side persistence and a small server-side response cache
- Complete authored fallback if the director is unavailable
