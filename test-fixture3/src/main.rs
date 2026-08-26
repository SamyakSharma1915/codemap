fn main() {
    let engine = Engine::new("my-project");
    engine.initialize();
}

pub struct Engine {
    name: String,
    running: bool,
}

impl Engine {
    pub fn new(name: &str) -> Engine {
        Engine { name: name.to_string(), running: false }
    }

    pub fn initialize(&mut self) {
        self.running = true;
    }
}

pub trait Runnable {
    fn run(&self);
}
