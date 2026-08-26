package main

import (
    "fmt"
    "os"
)

type Engine struct {
    name string
}

func (e *Engine) Init() {
    fmt.Println("init", e.name)
}

func NewEngine(name string) *Engine {
    return &Engine{name: name}
}

func main() {
    e := NewEngine("my-project")
    e.Init()
    os.Exit(0)
}
