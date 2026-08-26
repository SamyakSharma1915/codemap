#include "utils.h"

int clamp(int v, int lo, int hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

int sum(int a, int b) {
    return a + b;
}
