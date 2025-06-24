#pragma once
#include <memory>
#include <string>
#include <stdint.h>
#include "./PinnedArray.hpp"

struct zip_t;

class ZipFile {
private:
    struct zip_t* m_zip;
    bool is_file_open = false;
public:
    ZipFile(struct zip_t* zip): m_zip(zip) {}
    ~ZipFile();
    void write_file(const std::string& name, TypedPinnedArray<uint8_t> data);
    std::shared_ptr<TypedPinnedArray<uint8_t>> get_bytes();
    static std::shared_ptr<ZipFile> create();
};