#include "parser.h"
#include <stdlib.h>
#include <string.h>

struct Parser {
    const char *src;
};

Parser *parser_new(const char *src) {
    Parser *p = malloc(sizeof(Parser));
    p->src = src;
    return p;
}

int parser_run(Parser *p) {
    return p->src != NULL && strlen(p->src) > 0;
}

void parser_free(Parser *p) {
    free(p);
}
