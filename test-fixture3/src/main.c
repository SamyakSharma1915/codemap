#include <stdio.h>
#include "parser.h"
#include "utils.h"

typedef struct Engine Engine;

struct Engine {
    const char *name;
    int running;
};

int engine_init(Engine *e, const char *name) {
    e->name = name;
    e->running = 1;
    return parse(e->name) ? 1 : 0;
}

void engine_stop(Engine *e) {
    e->running = 0;
}

int main(void) {
    Engine e;
    if (engine_init(&e, "my-project")) {
        engine_stop(&e);
    }
    return 0;
}
