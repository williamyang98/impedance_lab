#include "./LU_Solver.hpp"
#include "./logging.hpp"
#include <vector>

extern "C" {
#include "slu_sdefs.h"
}

LU_Solver::Create_Result LU_Solver::create(
    TypedPinnedArray<float> A_non_zero_data,
    TypedPinnedArray<int32_t> A_col_indices, TypedPinnedArray<int32_t> A_row_index_ptr,
    int total_rows, int total_cols
) {
    MODULE_LOG("Setting default options for superlu\n");
    // from set_default_options()
    superlu_options_t options;
    {
        options.Fact = DOFACT;
        options.Equil = YES;
        options.ColPerm = COLAMD;
        options.Trans = NOTRANS;
        options.IterRefine = NOREFINE;
        options.DiagPivotThresh = 1.0;
        options.SymmetricMode = NO;
        options.PivotGrowth = NO;
        options.ConditionNumber = NO;
        options.PrintStat = YES;
    }

    // DOC: SuperLU Page 19 Section 2.3 - Matrix data structures
    // SRC: void sCreate_CompCol_Matrix(...)
    // NOTE: options->Trans is not used in sp_preorder (SLU_NC to SLU_NCP) or sgstrf (LU factorisation)
    //       instead we only need to pass it to sgstrs (solve) as the first parameter (transpose_mode)
    MODULE_LOG("Transpose CSR matrix to be interpreted as CSC matrix");
    const trans_t transpose_mode = TRANS;
    SuperMatrix A;
    A.Stype = SLU_NC;
    A.Dtype = SLU_S;
    A.Mtype = SLU_GE;
    A.nrow = total_cols;
    A.ncol = total_rows;
    NCformat Astore;
    A.Store = (void*)(&Astore);
    Astore.nnz = A_non_zero_data.get_length();
    Astore.nzval = A_non_zero_data.get_data();
    Astore.rowind = A_col_indices.get_data();
    Astore.colptr = A_row_index_ptr.get_data();

    // NOTE: Following steps are taken from sgssv()
    MODULE_LOG("Permute columns for A to convert from SLU_NC to SLU_NCP format\n");
    auto permute_col = std::vector<int>(A.ncol);
    if (options.ColPerm != MY_PERMC && options.Fact == DOFACT) {
        get_perm_c(options.ColPerm, &A, permute_col.data());
    }
    auto elimination_tree = std::vector<int>(A.ncol);
    SuperMatrix A_column_permuted;
    sp_preorder(&options, &A, permute_col.data(), elimination_tree.data(), &A_column_permuted);

    MODULE_LOG("Initialize the statistics variables\n");
    SuperLUStat_t stat;
    StatInit(&stat);

    MODULE_LOG("Perform LU factorisation using sgstrf() with row permutations for partial pivoting\n");
    auto permute_row = std::vector<int>(A.nrow);
    SuperMatrix L;
    SuperMatrix U;
    int_t lu_factor_info = 0;
    {
        const int panel_size = sp_ienv(1);
        const int relax = sp_ienv(2);
        const int work_array_size = 0; // 0 = allocate space internally by system malloc
        GlobalLU_t Glu;
        sgstrf(
            &options, &A_column_permuted,
            relax, panel_size, elimination_tree.data(),
            NULL, work_array_size,
            permute_col.data(), permute_row.data(),
            &L, &U,
            &Glu, &stat, &lu_factor_info
        );
    }

    Destroy_CompCol_Permuted(&A_column_permuted);

    if (lu_factor_info != 0) {
        StatFree(&stat);
        Destroy_SuperNode_Matrix(&L);
        Destroy_CompCol_Matrix(&U);
        return { nullptr, lu_factor_info };
    }

    const auto solver = std::make_shared<LU_Solver>(
        std::move(permute_col), std::move(permute_row), std::move(elimination_tree),
        stat, transpose_mode, L, U,
        total_rows, total_cols
    );
    return { solver, lu_factor_info };
}

int32_t LU_Solver::solve(TypedPinnedArray<float> B_data) {
    // DOC: SuperLU Page 19 Section 2.3 - Matrix data structures
    // SRC: void sCreate_Dense_Matrix(...)
    SuperMatrix B;
    B.Stype = SLU_DN;
    B.Dtype = SLU_S;
    B.Mtype = SLU_GE;
    B.nrow = B_data.get_length();
    B.ncol = 1;
    DNformat Bstore;
    B.Store = (void*)(&Bstore);
    Bstore.lda = B.nrow;
    Bstore.nzval = B_data.get_data();

    // NOTE: Following steps are taken from sgssv()
    MODULE_LOG("Solving for Ax=b using sgstrs\n");
    int_t solve_info = 0;
    sgstrs(m_transpose_mode, &m_L, &m_U, m_permute_col.data(), m_permute_row.data(), &B, &m_stat, &solve_info);
    return solve_info;
}

LU_Solver::~LU_Solver() {
    MODULE_LOG("Freeing LU solver\n");
    StatFree(&m_stat);
    Destroy_SuperNode_Matrix(&m_L);
    Destroy_CompCol_Matrix(&m_U);
}