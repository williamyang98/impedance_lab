#pragma once

#if(NDEBUG)
#define MODULE_LOG(...)
#else
#include <stdio.h>
#define MODULE_LOG(...) printf(__VA_ARGS__)
#endif