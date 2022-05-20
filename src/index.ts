import { Messages, PrismaClient } from "@prisma/client";
import express from "express";
import rateLimit from "express-rate-limit";
import http from "http";
import { EventEmitter } from "stream";
import { WebSocketServer } from "ws";

const prisma = new PrismaClient();
const app = express();

const messageCreate = new EventEmitter();

app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false
});

interface MessageCreate {
  content: number[];

  worldID: number;
  teri: number;
  x: number;
  y: number;
  z: number;
}

interface Message {
  id: number;
  content: number[];

  worldID: number;
  teri: number;
  x: number;
  y: number;
  z: number;
}

interface MessageCreateResult extends Message {
  deleteKey: string;
}

function checkIfPositiveInt(value: any) {
  return (
    typeof value === "number" &&
    value >= 0 &&
    !isNaN(value) &&
    value === +value &&
    value === (value | 0)
  );
}

function makeResponse(message: Messages): Message {
  return {
    id: message.id,
    content: message.content.split(" ").map((x) => parseInt(x)),

    worldID: message.worldID,
    teri: message.teri,
    x: message.x,
    y: message.y,
    z: message.z
  };
}

function makeid(length: number): string {
  let result = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

app.post("/messages", limiter, async (req, res) => {
  // i hate typescript
  const body: MessageCreate = req.body;
  if (!body.hasOwnProperty("worldID") || !checkIfPositiveInt(body.worldID)) {
    return res.status(400).end();
  }

  if (
    !body.hasOwnProperty("content") ||
    !Array.isArray(body.content) ||
    body.content.some((x) => !checkIfPositiveInt(x))
  ) {
    return res.status(400).end();
  }

  if (!body.hasOwnProperty("worldID") || !checkIfPositiveInt(body.worldID)) {
    return res.status(400).end();
  }

  if (!body.hasOwnProperty("teri") || !checkIfPositiveInt(body.teri)) {
    return res.status(400).end();
  }

  if (!body.hasOwnProperty("x") || typeof body.x !== "number") {
    return res.status(400).end();
  }

  if (!body.hasOwnProperty("y") || typeof body.y !== "number") {
    return res.status(400).end();
  }

  if (!body.hasOwnProperty("z") || typeof body.z !== "number") {
    return res.status(400).end();
  }

  const message = await prisma.messages.create({
    data: {
      content: body.content.join(" "),
      deleteKey: makeid(64),

      worldID: body.worldID,
      teri: body.teri,
      x: body.x,
      y: body.y,
      z: body.z
    }
  });

  messageCreate.emit("messageCreate", message);

  const response: MessageCreateResult = {
    id: message.id,
    content: message.content.split(" ").map((x) => parseInt(x)),
    deleteKey: message.deleteKey,

    worldID: message.worldID,
    teri: message.teri,
    x: message.x,
    y: message.y,
    z: message.z
  };

  return res.status(200).json(response);
});

interface MessagesQuery {
  teri: number;
  filter: number[];
}

app.get("/messages", async (req, res) => {
  const query: MessagesQuery = {
    teri: parseInt(<string>req.query.teri),
    filter: (<string>req.query.filter).split(",").map((x) => parseInt(x))
  };

  if (!query.hasOwnProperty("teri") || !checkIfPositiveInt(query.teri)) {
    return res.status(400).end();
  }

  if (
    !query.hasOwnProperty("filter") ||
    query.filter.some((x) => !checkIfPositiveInt(x))
  ) {
    return res.status(400).end();
  }

  const msgs = await prisma.messages.findMany({
    where: {
      worldID: {
        in: query.filter
      },
      teri: query.teri
    }
  });

  return res.json(msgs.map((x) => makeResponse(x)));
});

app.delete("/messages/:id", async (req, res) => {
  const deleteKey = req.query["deleteKey"];
  const id = parseInt(req.params.id);

  const message = await prisma.messages.findUnique({
    where: {
      id: id
    }
  });

  if (!message) {
    return res.status(400).end();
  }

  if (message.deleteKey !== deleteKey) {
    return res.status(401).end();
  }

  await prisma.messages.delete({
    where: {
      id: id
    }
  });

  return res.status(204).end();
});

app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (err) return res.sendStatus(500);

    next();
  }
);

const server = http.createServer(app);
const wss = new WebSocketServer({
  server: server,
  path: "/ws"
});

interface ClientSettings {
  teri: number;
  filter: number[];
}

type Nullable<T> = T | null;

wss.on("connection", (conn) => {
  let clientSettings: Nullable<ClientSettings> = null;

  messageCreate.on("messageCreate", (msg) => {
    if (clientSettings === null) return;

    if (
      clientSettings.filter.includes(msg.worldID) &&
      clientSettings.teri === msg.teri
    ) {
      conn.send(JSON.stringify(makeResponse(msg)));
    }
  });

  conn.on("message", (msg) => {
    try {
      const settings: ClientSettings = JSON.parse(msg.toString());

      if (
        !settings.hasOwnProperty("teri") ||
        !checkIfPositiveInt(settings.teri)
      ) {
        throw new Error("i love shitty control flow");
      }

      if (
        !settings.hasOwnProperty("filter") ||
        settings.filter.some((x) => !checkIfPositiveInt(x))
      ) {
        throw new Error("i love shitty control flow");
      }

      clientSettings = settings;
    } catch (err) {
      console.log("byebye");
      // user probably sent fucked data
      conn.close();
      conn.terminate();
    }
  });
});

server.listen(process.env.PORT, () => {
  console.log(`listening on port ${process.env.PORT}`);
});
