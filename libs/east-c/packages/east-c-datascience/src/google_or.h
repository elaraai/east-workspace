/*
 * What the OR-Tools modules share: the status variant every result carries,
 * and the East names of its cases.
 */
#ifndef EAST_DATASCIENCE_GOOGLE_OR_H
#define EAST_DATASCIENCE_GOOGLE_OR_H

#include "value_util.h"

namespace east_ds
{

/* A GoogleOrStatusType value of the declared type: `optimal`, `feasible`,
 * `infeasible`, `not_solved` or `model_invalid`. */
inline EastValue *status(EastType *status_type, const char *tag)
{
    return variant(status_type, tag);
}

/* The row structure every columnar model must have, refused by name as the
 * python runner refuses it: `row_ptr` one longer than the rows, from 0 to the
 * term count, never decreasing; a coefficient per term; every column a
 * variable of the model. */
inline void check_rows(const char *fn, size_t n_vars, const std::vector<int64_t> &row_ptr,
                       const std::vector<int64_t> &col_ix, size_t n_coeff, size_t n_rows)
{
    if (row_ptr.size() != n_rows + 1)
        throw Error(msg(fn, "row_ptr has " + std::to_string(row_ptr.size()) +
                                " entries but there are " + std::to_string(n_rows) +
                                " rows: it needs " + std::to_string(n_rows + 1)));
    if (!row_ptr.empty() &&
        (row_ptr.front() != 0 || row_ptr.back() != static_cast<int64_t>(col_ix.size())))
        throw Error(msg(fn, "row_ptr must start at 0 and end at the term count " +
                                std::to_string(col_ix.size()) + ", got " +
                                std::to_string(row_ptr.front()) + " and " +
                                std::to_string(row_ptr.back())));
    for (size_t r = 1; r < row_ptr.size(); r++)
        if (row_ptr[r] < row_ptr[r - 1]) throw Error(msg(fn, "row_ptr must not decrease"));
    if (col_ix.size() != n_coeff)
        throw Error(msg(fn, "col_ix has " + std::to_string(col_ix.size()) +
                                " entries but coeff has " + std::to_string(n_coeff) +
                                ": one coefficient per term"));
    for (int64_t c : col_ix)
        if (c < 0 || c >= static_cast<int64_t>(n_vars))
            throw Error(msg(fn, "col_ix names a variable outside 0 .. " +
                                    std::to_string(n_vars == 0 ? 0 : n_vars - 1)));
}

} // namespace east_ds

#endif
