#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <memory>

// Map between wasm module's ArrayBuffer heap and C++ environment
// SRC: https://kapadia.github.io/emscripten/2013/09/13/emscripten-pointers-and-pointers.html
// SRC: https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html#access-memory-from-javascript
class PinnedArray
{
private:
    const int32_t m_address;
    const int m_length;
    const bool m_owned;
public:
    PinnedArray(int32_t address, int length, bool owned)
    : m_address(address), m_length(length), m_owned(owned) {}
    ~PinnedArray() {
        if (m_owned) {
            printf("Freeing pinned array at addr=%d, len=%d\n", m_address, m_length);
            free(reinterpret_cast<void*>(m_address));
        }
    }
    static std::shared_ptr<PinnedArray> owned_pin_from_malloc(int length) {
        int32_t address = reinterpret_cast<int32_t>(malloc(length));
        return std::make_shared<PinnedArray>(address, length, true);
    }
    static std::shared_ptr<PinnedArray> weak_pin_from_address_length(int32_t address, int length) {
        return std::make_shared<PinnedArray>(address, length, false);
    }
    inline int32_t get_address() const { return m_address; };
    inline int get_length() const { return m_length; }
    inline void* get_data() const { return reinterpret_cast<void*>(m_address); }
};

template <typename T>
class TypedPinnedArray
{
public:
    std::shared_ptr<PinnedArray> m_pin;
public:
    TypedPinnedArray(std::shared_ptr<PinnedArray> pin): m_pin(pin) {}
    static std::shared_ptr<TypedPinnedArray<T>> from_pin(std::shared_ptr<PinnedArray> pin) { 
        return std::make_shared<TypedPinnedArray<T>>(pin);
    }
    static std::shared_ptr<TypedPinnedArray<T>> owned_pin_from_malloc(int length) {
        auto pin = PinnedArray::owned_pin_from_malloc(length * sizeof(T));
        return std::make_shared<TypedPinnedArray<T>>(pin);
    }
    static std::shared_ptr<TypedPinnedArray<T>> weak_pin_from_address_length(int32_t address, int length) {
        auto pin = PinnedArray::weak_pin_from_address_length(address, length * sizeof(T));
        return std::make_shared<TypedPinnedArray<T>>(pin);
    }
    inline int32_t get_address() const { return m_pin->get_address(); }
    inline int get_length() const { return m_pin->get_length() / sizeof(T); }
    inline T* get_data() const { return reinterpret_cast<T*>(m_pin->get_data()); }
    inline T& operator[](int i) { return get_data()[i]; }
    inline const T& operator[](int i) const { return get_data()[i]; }

    template <typename U>
    explicit operator TypedPinnedArray<U>() const {
        return TypedPinnedArray<U>(m_pin);
    }
};
