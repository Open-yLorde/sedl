// -------------------------
// TOKENIZER
// -------------------------

type TokenType =
    | "IDENT"
    | "STRING"
    | "NUMBER"
    | "LBRACE"
    | "RBRACE"
    | "EQUAL"
    | "SEMICOLON"
    | "ARROW"
    | "LPAREN"
    | "RPAREN"
    | "COLON";

interface Token {
    type: TokenType;
    value?: string;
}

export function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    const regex = /\s+|#.*|"(.*?)"|(->)|[{}=;():]|[A-Za-z_][A-Za-z0-9_]*|\d+/g;

    let match;
    while ((match = regex.exec(input))) {
        const [text] = match;

        if (/^\s+$/.test(text) || text.startsWith("#")) continue;

        if (text === "{") tokens.push({ type: "LBRACE" });
        else if (text === "}") tokens.push({ type: "RBRACE" });
        else if (text === "=") tokens.push({ type: "EQUAL" });
        else if (text === ";") tokens.push({ type: "SEMICOLON" });
        else if (text === "->") tokens.push({ type: "ARROW" });
        else if (text === "(") tokens.push({ type: "LPAREN" });
        else if (text === ")") tokens.push({ type: "RPAREN" });
        else if (text === ":") tokens.push({ type: "COLON" });
        else if (match[1]) tokens.push({ type: "STRING", value: match[1] });
        else if (/^\d+$/.test(text)) tokens.push({ type: "NUMBER", value: text });
        else tokens.push({ type: "IDENT", value: text });
    }

    return tokens;
}

// -------------------------
// PARSER (SAFE AST)
// -------------------------

interface EnvVar {
    key: string;
    value: string;
    secret?: boolean;
}

interface Service {
    name: string;
    image: string;
    ports: string[];
    env: EnvVar[];
    inheritEnv?: boolean;
}

interface Project {
    name: string;
    env: EnvVar[];
    services: Service[];
}

export function parse(tokens: Token[]): Project {
    let i = 0;

    function expect(type: TokenType): Token {
        const t = tokens[i++];
        if (!t || t.type !== type) {
            const found = t ? `${t.type}${t.value ? ` (${t.value})` : ""}` : "end of file";
            throw new Error(`Expected ${type} but found ${found} at token position ${i - 1}`);
        }
        return t;
    }

    function parseValue(): EnvVar {
        const key = expect("IDENT").value!;
        expect("EQUAL");

        let valueToken: any = tokens[i++];
        let value = "";
        let secret = false;

        if (valueToken.type === "STRING") {
            value = valueToken.value!;
        } else if (valueToken.type === "NUMBER") {
            value = valueToken.value!;
        } else if (valueToken.type === "IDENT" && valueToken.value === "secret") {
            expect("LPAREN");
            value = expect("STRING").value!;
            expect("RPAREN");
            secret = true;
        } else {
            throw new Error("Invalid value");
        }

        expect("SEMICOLON");
        return { key, value, secret };
    }

    expect("IDENT"); // project
    const name = expect("STRING").value!;
    expect("LBRACE");

    const project: Project = { name, env: [], services: [] };

    while (tokens[i] && tokens[i].type !== "RBRACE") {
        const token = tokens[i++];

        if (token.value === "env") {
            expect("LBRACE");
            while (tokens[i] && tokens[i].type !== "RBRACE") {
                project.env.push(parseValue());
            }
            expect("RBRACE");
        }

        if (token.value === "service") {
            const serviceName = expect("STRING").value!;
            expect("LBRACE");

            const service: Service = {
                name: serviceName,
                image: "",
                ports: [],
                env: [],
            };

            while (tokens[i] && tokens[i].type !== "RBRACE") {
                const t = tokens[i++];

                if (t.value === "image") {
                    expect("EQUAL");
                    service.image = expect("STRING").value!;
                    expect("SEMICOLON");
                }

                if (t.value === "port") {
                    expect("EQUAL");
                    const from = expect("NUMBER").value!;
                    expect("ARROW");
                    const to = expect("NUMBER").value!;
                    service.ports.push(`${from}:${to}`);
                    expect("SEMICOLON");
                }

                if (t.value === "env") {
                    if (tokens[i] && tokens[i].type === "COLON") {
                        i++;
                        expect("IDENT"); // inherit
                        service.inheritEnv = true;
                        expect("SEMICOLON");
                    } else {
                        expect("LBRACE");
                        while (tokens[i] && tokens[i].type !== "RBRACE") {
                            service.env.push(parseValue());
                        }
                        expect("RBRACE");
                    }
                }
            }

            expect("RBRACE");
            if (!service.image) {
                throw new Error(`Service "${service.name}" missing required 'image' field`);
            }
            project.services.push(service);
        }
    }

    expect("RBRACE");
    return project;
}

// -------------------------
// GENERATORS
// -------------------------

export function toEnv(project: Project): string {
    const escapeValue = (val: string): string => {
        // Escape special characters in env values
        if (val.includes(" ") || val.includes("=") || val.includes("'") || val.includes("\"")) {
            return `"${val.replace(/"/g, '\\"')}"`;
        }
        return val;
    };

    return project.env
        .map((e) => `${e.key}=${escapeValue(e.value)}`)
        .join("\n");
}

export function toDockerCompose(project: Project): string {
    const escapeValue = (val: string): string => {
        // Escape values for docker-compose YAML
        if (val.includes(":") || val.includes(",") || val.includes("#") || val.includes("\"")) {
            return `"${val.replace(/"/g, '\\"')}"`;
        }
        return val;
    };

    const services = project.services
        .map((s) => {
            const envVars = [...(s.inheritEnv ? project.env : []), ...s.env];
            const envLines = envVars
                .map((e) => `      - ${e.key}=${escapeValue(e.value)}`)
                .join("\n");

            return `  ${s.name}:
    image: ${s.image}
    ports:
      - ${s.ports.join("\n      - ")}
    environment:\n${envLines}`;
        })
        .join("\n");

    return `version: "3.9"
services:
${services}`;
}

// -------------------------
// CLI
// -------------------------

//#!/usr/bin/env node
import fs from "fs";

function main() {
    try {
        const filePath = process.argv[2];
        const distDir = "dist";

        if (!filePath) {
            console.error("Error: Please provide a configuration file path");
            console.error("Usage: ts-node index.ts <config-file>");
            process.exit(1);
        }

        if (!fs.existsSync(filePath)) {
            console.error(`Error: File not found: ${filePath}`);
            process.exit(1);
        }

        const input = fs.readFileSync(filePath, "utf-8");

        if (!input.trim()) {
            console.error("Error: Configuration file is empty");
            process.exit(1);
        }

        const tokens = tokenize(input);
        const ast = parse(tokens);

        if (!ast.services || ast.services.length === 0) {
            console.warn("Warning: No services defined in configuration");
        }

        // Create .dist directory if it doesn't exist
        if (!fs.existsSync(distDir)) {
            fs.mkdirSync(distDir, { recursive: true });
        }

        fs.writeFileSync(`${distDir}/.env`, toEnv(ast));
        fs.writeFileSync(`${distDir}/docker-compose.yml`, toDockerCompose(ast));

        console.log(`✔ Generated ${distDir}/.env and ${distDir}/docker-compose.yml`);
    } catch (error) {
        if (error instanceof Error) {
            console.error(`Error: ${error.message}`);
        } else {
            console.error("An unknown error occurred");
        }
        process.exit(1);
    }
}

main();