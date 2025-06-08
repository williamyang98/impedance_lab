#include <emscripten/bind.h>
#include "./PinnedArray.hpp"
#include "./LU_Solver.hpp"
#include "./energy_integral.hpp"

// SRC: https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html#classes
#define BIND_TYPED_PINNED_ARRAY(prefix, type) \
    class_<TypedPinnedArray<type>>(prefix "PinnedArray") \
        .smart_ptr_constructor(prefix "PinnedArray", &TypedPinnedArray<type>::owned_pin_from_malloc) \
        .class_function("weak_pin_from_address_length", &TypedPinnedArray<type>::weak_pin_from_address_length) \
        .class_function("from_pin", &TypedPinnedArray<type>::from_pin) \
        .property("pin", &TypedPinnedArray<type>::m_pin) \
        .property("address", &TypedPinnedArray<type>::get_address) \
        .property("length", &TypedPinnedArray<type>::get_length);

namespace emscripten {
    EMSCRIPTEN_BINDINGS(my_module) {
        class_<LU_Solver>("LU_Solver")
            .smart_ptr_constructor("LU_Solver", &LU_Solver::create)
            .function("solve", &LU_Solver::solve);
        class_<PinnedArray>("PinnedArray")
            .smart_ptr_constructor("PinnedArray", &PinnedArray::owned_pin_from_malloc)
            .class_function("weak_pin_from_address_length", &PinnedArray::weak_pin_from_address_length)
            .property("address", &PinnedArray::get_address)
            .property("length", &PinnedArray::get_length);
        BIND_TYPED_PINNED_ARRAY("Int8", int8_t);
        BIND_TYPED_PINNED_ARRAY("Uint8", uint8_t);
        BIND_TYPED_PINNED_ARRAY("Int16", int16_t);
        BIND_TYPED_PINNED_ARRAY("Uint16", uint16_t);
        BIND_TYPED_PINNED_ARRAY("Int32", int32_t);
        BIND_TYPED_PINNED_ARRAY("Uint32", uint32_t);
        BIND_TYPED_PINNED_ARRAY("Float32", float);
        BIND_TYPED_PINNED_ARRAY("Float64", double);
        function("calculate_homogenous_energy_2d", &calculate_homogenous_energy_2d);
        function("calculate_inhomogenous_energy_2d", &calculate_inhomogenous_energy_2d);
        function("calculate_e_field", &calculate_e_field);
    }
}
