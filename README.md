# SEDL - Secure Env DSL

## Install

npm install -g sedl

## Usage

sedl config.sedl

## Output

.env
docker-compose.yml

## Example

```
project "demo" {
  env {
    PORT = 3000;
    NODE_ENV = "production";
  }

  service "app" {
    image = "node:20";
    port = 3000 -> 3000;
    env: inherit;
  }
}
```


## Syntax

```
project "my-app" {
  env {
    PORT = 3000;
    NODE_ENV = "production";
    API_KEY = secret("my_api_key");
  }

  service "web" {
    image = "node:20";
    port = 3000 -> 3000;
    env: inherit;
  }

  service "db" {
    image = "postgres:15";
    env {
      POSTGRES_PASSWORD = secret("db_pass");
    }
    port = 5432 -> 5432;
  }
}
```