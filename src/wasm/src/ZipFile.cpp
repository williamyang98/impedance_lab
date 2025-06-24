#include "./ZipFile.hpp"
#include <zip.h>
#include <stddef.h>
#include "./PinnedArray.hpp"

std::shared_ptr<ZipFile> ZipFile::create() {
    struct zip_t* zip = zip_stream_open(nullptr, 0, ZIP_DEFAULT_COMPRESSION_LEVEL, 'w');
    if (zip == nullptr) return nullptr;
    return std::make_shared<ZipFile>(zip);
}

ZipFile::~ZipFile() {
    zip_stream_close(m_zip);
}

void ZipFile::write_file(const std::string& name, TypedPinnedArray<uint8_t> data) {
    zip_entry_open(m_zip, name.c_str());
    zip_entry_write(m_zip, reinterpret_cast<void*>(data.get_data()), data.get_length());
    zip_entry_close(m_zip);
}

std::shared_ptr<TypedPinnedArray<uint8_t>> ZipFile::get_bytes() {
    uint8_t* buf_out = nullptr;
    size_t buf_size = 0;
    zip_stream_copy(m_zip, reinterpret_cast<void**>(&buf_out), &buf_size);
    if (buf_out == nullptr || buf_size == 0) {
        return nullptr;
    }
    const auto pin = std::make_shared<PinnedArray>(reinterpret_cast<int32_t>(buf_out), buf_size, true); 
    const auto typed_pin = std::make_shared<TypedPinnedArray<uint8_t>>(pin);
    return typed_pin;
}