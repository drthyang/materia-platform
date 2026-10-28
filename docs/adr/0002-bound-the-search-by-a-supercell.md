# Bound every subgroup search by a supercell

A subgroup search takes a supercell bound P (default: the 2×2×2 conventional cell; the user can enter any P) plus a maximum index. The bound fixes the finite group that subgroups, irreps and modes live in, and it says which cell a child is built in; an index alone does not. k-subgroups are infinite in number, so a search without a bound is refused rather than truncated silently.
