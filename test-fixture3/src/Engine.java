public class Engine {
    private String name;

    public Engine(String name) {
        this.name = name;
    }

    public void initialize() {
        Parser p = new Parser(name);
        p.parse();
    }

    public static void main(String[] args) {
        Engine e = new Engine("my-project");
        e.initialize();
    }
}
