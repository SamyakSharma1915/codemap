public class Parser {
    private String src;

    public Parser(String src) {
        this.src = src;
    }

    public int parse() {
        return src.length();
    }
}
