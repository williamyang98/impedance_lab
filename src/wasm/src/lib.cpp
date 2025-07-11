#include <emscripten/bind.h>
#include "./PinnedArray.hpp"
#include "./LU_Solver.hpp"
#include "./ZipFile.hpp"
#include "./energy_integral.hpp"
#include "./convert_f32_to_f16.hpp"
#include <memory>

// SRC: https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html#classes
#define BIND_TYPED_PINNED_ARRAY(prefix, type) \
    class_<TypedPinnedArray<type>>(prefix "PinnedArray") \
        .smart_ptr<std::shared_ptr<TypedPinnedArray<type>>>(prefix "PinnedArray") \
        .class_function("owned_pin_from_malloc(length)", &TypedPinnedArray<type>::owned_pin_from_malloc) \
        .class_function("weak_pin_from_address_length(address, length)", &TypedPinnedArray<type>::weak_pin_from_address_length) \
        .class_function("from_pin(pin)", &TypedPinnedArray<type>::from_pin) \
        .property("pin", &TypedPinnedArray<type>::m_pin) \
        .property("address", &TypedPinnedArray<type>::get_address) \
        .property("length", &TypedPinnedArray<type>::get_length);

namespace emscripten {
    EMSCRIPTEN_BINDINGS(my_module) {
        class_<LU_Solver>("LU_Solver")
            .smart_ptr<std::shared_ptr<LU_Solver>>("LU_Solver")
            .class_function(
                "create(A_non_zero_data, A_col_indices, A_row_index_pointers, total_rows, total_columns)", 
                &LU_Solver::create
            )
            .function("solve(b)", &LU_Solver::solve)
            .property("total_rows", &LU_Solver::get_total_rows, return_value_policy::reference())
            .property("total_cols", &LU_Solver::get_total_cols, return_value_policy::reference());
        class_<LU_Solver::Create_Result>("LU_Solver_Create_Result")
            .property("solver", &LU_Solver::Create_Result::solver)
            .property("lu_factor_info", &LU_Solver::Create_Result::lu_factor_info);
        class_<PinnedArray>("PinnedArray")
            .smart_ptr<std::shared_ptr<PinnedArray>>("PinnedArray")
            .class_function("owned_pin_from_malloc(length)", &PinnedArray::owned_pin_from_malloc)
            .class_function("weak_pin_from_address_length(address, length)", &PinnedArray::weak_pin_from_address_length)
            .property("address", &PinnedArray::get_address)
            .property("length", &PinnedArray::get_length);
        class_<ZipFile>("ZipFile")
            .smart_ptr<std::shared_ptr<ZipFile>>("ZipFile")
            .class_function(
                "create()", 
                &ZipFile::create
            )
            .function("write_file(name, data)", &ZipFile::write_file)
            .function("get_bytes()", &ZipFile::get_bytes);
        BIND_TYPED_PINNED_ARRAY("Int8", int8_t);
        BIND_TYPED_PINNED_ARRAY("Uint8", uint8_t);
        BIND_TYPED_PINNED_ARRAY("Int16", int16_t);
        BIND_TYPED_PINNED_ARRAY("Uint16", uint16_t);
        BIND_TYPED_PINNED_ARRAY("Int32", int32_t);
        BIND_TYPED_PINNED_ARRAY("Uint32", uint32_t);
        BIND_TYPED_PINNED_ARRAY("Float32", float);
        BIND_TYPED_PINNED_ARRAY("Float64", double);
        function("calculate_homogenous_energy_2d(ex_field, ey_field, dx, dy)", &calculate_homogenous_energy_2d);
        function("calculate_inhomogenous_energy_2d(ex_field, ey_field, dx, dy, er_table, er_index_beta)", &calculate_inhomogenous_energy_2d);
        function("calculate_e_field(ex_field_out, ey_field_out, v_field_in, dx_in, dy_in)", &calculate_e_field);
        function("convert_f32_to_f16(f32_in, f16_out)", &convert_f32_to_f16);
    }
}
