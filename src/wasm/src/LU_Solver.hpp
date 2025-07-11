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
public:
    struct Create_Result {
        std::shared_ptr<LU_Solver> solver = nullptr;
        int_t lu_factor_info = 0;
    };
private:
    std::vector<int> m_permute_col;
    std::vector<int> m_permute_row;
    std::vector<int> m_elimination_tree;
    SuperLUStat_t m_stat;
    trans_t m_transpose_mode;
    SuperMatrix m_L;
    SuperMatrix m_U;
    int m_total_rows;
    int m_total_cols;
public:
    LU_Solver(
        std::vector<int>&& permute_col, std::vector<int>&& permute_row, std::vector<int>&& elimination_tree,
        SuperLUStat_t stat, trans_t transpose_mode, SuperMatrix L, SuperMatrix U,
        int total_rows, int total_cols
    ): 
        m_permute_col(permute_col), m_permute_row(permute_row), m_elimination_tree(elimination_tree),
        m_stat(stat), m_transpose_mode(transpose_mode), m_L(L), m_U(U),
        m_total_rows(total_rows), m_total_cols(total_cols)
    {}
    ~LU_Solver();
    static Create_Result create(
        TypedPinnedArray<float> A_non_zero_data,
        TypedPinnedArray<int32_t> A_col_indices, TypedPinnedArray<int32_t> A_row_index_ptr,
        int total_rows, int total_cols
    );
    int32_t solve(TypedPinnedArray<float> B_data);
    int get_total_rows() const { return m_total_rows; }
    int get_total_cols() const { return m_total_cols; }
};
