// Test-only independent BC7 decoder. bc7decomp is downloaded at a pinned commit.
#include "bc7decomp.h"
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>
#include <cstdint>

int main(int argc, char** argv) {
    if (argc != 3) return 2;
    std::ifstream input(argv[1], std::ios::binary);
    std::vector<uint8_t> data((std::istreambuf_iterator<char>(input)), {});
    auto u32 = [&](size_t offset) { uint32_t v; std::memcpy(&v, data.data()+offset, 4); return v; };
    if (data.size() < 52 || u32(0) != 0x03525650 || u32(8) != 15) return 3;
    uint32_t width=u32(28), height=u32(24), offset=52+u32(48);
    if (!width || !height || width>16384 || height>16384 || width%4 || height%4 || data.size() < offset+uint64_t(width)*height) return 4;
    std::vector<uint8_t> rgba(uint64_t(width)*height*4);
    for (uint32_t y=0; y<height; y+=4) for (uint32_t x=0; x<width; x+=4) {
        bc7decomp::color_rgba pixels[16];
        if (!bc7decomp::unpack_bc7(data.data()+offset, pixels)) return 5;
        offset+=16;
        for (uint32_t row=0; row<4; row++) std::memcpy(rgba.data()+((y+row)*width+x)*4, pixels+row*4,16);
    }
    // Uncompressed RGBA PVR for vendor PNG export; BC7 decode was performed above.
    uint32_t header[13]={0x03525650,0,0x61626772,0x08080808,0,0,height,width,1,1,1,1,0};
    std::ofstream output(argv[2],std::ios::binary);
    output.write(reinterpret_cast<char*>(header),sizeof(header));
    output.write(reinterpret_cast<char*>(rgba.data()),rgba.size());
    return output.good()?0:6;
}
