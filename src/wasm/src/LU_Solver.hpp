#pragma once

extern "C" {
#include "slu_sdefs.h"
}
#include <stdint.h>
#include <memory>
#include <vector>
#include "./PinnedArray.hpp"

class LU_Solver 
{
private:
    std::vector<int> m_permute_col;
    std::vector<int> m_permute_row;
    std::vector<int> m_elimination_tree;
    SuperLUStat_t m_stat;
    trans_t m_transpose_mode;
    SuperMatrix m_L;
    SuperMatrix m_U;
public:
    LU_Solver(
        std::vector<int>&& permute_col, std::vector<int>&& permute_row, std::vector<int>&& elimination_tree,
        SuperLUStat_t stat, trans_t transpose_mode, SuperMatrix L, SuperMatrix U
    ): 
        m_permute_col(permute_col), m_permute_row(permute_row), m_elimination_tree(elimination_tree),
        m_stat(stat), m_transpose_mode(transpose_mode), m_L(L), m_U(U)
    {}
    ~LU_Solver();
    static std::shared_ptr<LU_Solver> create(
        TypedPinnedArray<float> A_non_zero_data,
        TypedPinnedArray<int32_t> A_col_indices, TypedPinnedArray<int32_t> A_row_index_ptr,
        int total_rows, int total_cols
    );
    int32_t solve(TypedPinnedArray<float> B_data);
};
