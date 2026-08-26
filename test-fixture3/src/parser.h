#ifndef PARSER_H
#define PARSER_H

typedef struct Parser Parser;

Parser *parser_new(const char *src);
int parser_run(Parser *p);
void parser_free(Parser *p);

#endif
