import java.rmi.RemoteException;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.rmi.server.UnicastRemoteObject;
import java.util.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import com.sun.net.httpserver.*;
import javax.xml.parsers.*;
import javax.xml.transform.*;
import javax.xml.transform.dom.*;
import javax.xml.transform.stream.*;
import org.w3c.dom.*;

public class ChatServer implements ChatInterface, java.rmi.Remote {
    private Map<String, List<String>> userMessages = new HashMap<>();
    private Set<String> connectedUsers = new HashSet<>();
    private HttpServer httpServer;
    private static final int RMI_PORT = 1099;
    private static final int HTTP_PORT = 8080;

    public synchronized void registerUser(String username) {
        connectedUsers.add(username);
    }

    public synchronized void unregisterUser(String username) {
        connectedUsers.remove(username);
    }

    public synchronized void sendMessage(String from, String to, String message) {
        String key = getKey(from, to);
        userMessages.putIfAbsent(key, new ArrayList<>());
        String formatted = from + ": " + message;
        userMessages.get(key).add(formatted);
        saveMessageToXML(from, to, message);
    }

    public synchronized void sendBroadcast(String from, String message) {
        for (String user : connectedUsers) {
            if (!user.equals(from)) {
                sendMessage(from, user, "[Broadcast] " + message);
            }
        }
    }

    public synchronized List<String> getMessages(String user1, String user2) {
        return userMessages.getOrDefault(getKey(user1, user2), new ArrayList<>());
    }

    public synchronized List<String> getConnectedUsers() {
        return new ArrayList<>(connectedUsers);
    }

    private String getKey(String user1, String user2) {
        return user1.compareTo(user2) < 0 ? user1 + ":" + user2 : user2 + ":" + user1;
    }

    private void saveMessageToXML(String from, String to, String message) {
        try {
            File file = new File("chat_log.xml");
            Document doc;
            Element root;

            if (!file.exists()) {
                doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().newDocument();
                root = doc.createElement("chat");
                doc.appendChild(root);
            } else {
                doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file);
                root = doc.getDocumentElement();
            }

            Element msg = doc.createElement("message");

            Element fromEl = doc.createElement("from");
            fromEl.setTextContent(from);
            msg.appendChild(fromEl);

            Element toEl = doc.createElement("to");
            toEl.setTextContent(to);
            msg.appendChild(toEl);

            Element textEl = doc.createElement("text");
            textEl.setTextContent(message);
            msg.appendChild(textEl);

            Element time = doc.createElement("timestamp");
            time.setTextContent(new Date().toString());
            msg.appendChild(time);

            root.appendChild(msg);

            Transformer transformer = TransformerFactory.newInstance().newTransformer();
            transformer.setOutputProperty(OutputKeys.INDENT, "yes");
            transformer.transform(new DOMSource(doc), new StreamResult(file));

        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void serveStaticFile(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        if (path.equals("/")) path = "/index.html";
        
        System.out.println("Intentando recuperar: " + path);
        
        try {
            File file = new File("src/web" + path).getCanonicalFile();
            System.out.println("Buscando el archivo en: " + file.getAbsolutePath());
            
            if (!file.exists()) {
                System.out.println("Archivo no encontrado!");
                sendErrorResponse(exchange, 404, "No encontrado");
                return;
            }
            
            String contentType = "text/html";
            if (path.endsWith(".js")) {
                contentType = "application/javascript";
            } else if (path.endsWith(".css")) {
                contentType = "text/css";
            }
            
            byte[] fileData = Files.readAllBytes(file.toPath());
            
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.sendResponseHeaders(200, fileData.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(fileData);
            }
            
            System.out.println("Exito al encontrar: " + path);
        } catch (Exception e) {
            System.out.println("Error al encontrar el archivo: " + e.getMessage());
            sendErrorResponse(exchange, 500, "Error del servidor");
        }
    }
    
    private void startHttpServer() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(HTTP_PORT), 0);
        server.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            System.out.println("Peticion de: " + path);
            
            if (path.startsWith("/api")) {
                try {
                    exchange.getResponseHeaders().add("Content-Type", "application/xml");
                    if ("POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                        handlePostRequest(exchange, path);
                    } else {
                        handleGetRequest(exchange, path);
                    }
                } catch (Exception e) {
                    sendErrorResponse(exchange, 500, "Error del servidor");
                }
            } else {
                serveStaticFile(exchange);
            }
        });
        server.setExecutor(null);
        server.start();
        //System.out.println("Servidor HTTP iniciado en el puerto " + HTTP_PORT);
    }

    private void handlePostRequest(HttpExchange exchange, String path) throws IOException {
        if ("/api/register".equals(path)) {
            handleRegister(exchange);
        } else if ("/api/send".equals(path)) {
            handleSendMessage(exchange);
        } else {
            sendErrorResponse(exchange, 404, "No encontrado");
        }
    }

    private void handleGetRequest(HttpExchange exchange, String path) throws IOException {
        if ("/api/users".equals(path)) {
            handleGetUsers(exchange);
        } else if ("/api/messages".equals(path)) {
            handleGetMessages(exchange);
        } else {
            sendErrorResponse(exchange, 404, "No encontrado");
        }
    }

    private void handleRegister(HttpExchange exchange) throws IOException {
        try {
            Document doc = parseRequestBody(exchange);
            String username = doc.getElementsByTagName("name").item(0).getTextContent();
            
            registerUser(username);
            sendXMLResponse(exchange, "<status>OK</status>");
        } catch (Exception e) {
            sendErrorResponse(exchange, 400, "Formato XML invalido");
        }
    }

    private void handleSendMessage(HttpExchange exchange) throws IOException {
        try {
            String rawXml = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            System.out.println("Received raw XML: " + rawXml);
    
            Document doc = DocumentBuilderFactory.newInstance()
                .newDocumentBuilder()
                .parse(new ByteArrayInputStream(rawXml.getBytes()));
            
            String from = getFirstElementText(doc, "from", "sender");
            String to = getFirstElementText(doc, "to", "recipient");
            String text = getFirstElementText(doc, "text", "message", "content");
    
            if (from == null || to == null || text == null) {
                sendErrorResponse(exchange, 400, "Faltan campos (from/to/text)");
                return;
            }
    
            if ("all".equalsIgnoreCase(to)) {
                sendBroadcast(from, text);
            } else {
                sendMessage(from, to, text);
            }
            
            sendXMLResponse(exchange, "<response><status>OK</status></response>");
        } catch (Exception e) {
            System.err.println("Error al procesar el mesnaje: " + e.getMessage());
            sendErrorResponse(exchange, 400, "Formato de mensaje invalido");
        }
    }
    
    private String getFirstElementText(Document doc, String... possibleTags) {
        for (String tag : possibleTags) {
            NodeList nodes = doc.getElementsByTagName(tag);
            if (nodes.getLength() > 0) {
                return nodes.item(0).getTextContent();
            }
        }
        return null;
    }

    private void handleGetUsers(HttpExchange exchange) throws IOException {
        try {
            Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().newDocument();
            Element root = doc.createElement("users");
            doc.appendChild(root);

            for (String user : getConnectedUsers()) {
                Element userEl = doc.createElement("user");
                userEl.setTextContent(user);
                root.appendChild(userEl);
            }

            sendXMLResponse(exchange, documentToString(doc));
        } catch (Exception e) {
            sendErrorResponse(exchange, 500, "Error al generar la lista de usuarios");
        }
    }

    private void handleGetMessages(HttpExchange exchange) throws IOException {
        try {
            String query = exchange.getRequestURI().getQuery();
            Map<String, String> params = parseQuery(query);
            
            List<String> messages = getMessages(params.get("user1"), params.get("user2"));
            
            Document doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().newDocument();
            Element root = doc.createElement("messages");
            doc.appendChild(root);

            for (String msg : messages) {
                Element msgEl = doc.createElement("message");
                msgEl.setTextContent(msg);
                root.appendChild(msgEl);
            }

            sendXMLResponse(exchange, documentToString(doc));
        } catch (Exception e) {
            sendErrorResponse(exchange, 400, "Peticion invalida");
        }
    }

    private Document parseRequestBody(HttpExchange exchange) throws Exception {
        InputStream is = exchange.getRequestBody();
        DocumentBuilder db = DocumentBuilderFactory.newInstance().newDocumentBuilder();
        return db.parse(is);
    }

    private String documentToString(Document doc) throws TransformerException {
        TransformerFactory tf = TransformerFactory.newInstance();
        Transformer transformer = tf.newTransformer();
        StringWriter writer = new StringWriter();
        transformer.transform(new DOMSource(doc), new StreamResult(writer));
        return writer.toString();
    }

    private Map<String, String> parseQuery(String query) {
        Map<String, String> result = new HashMap<>();
        if (query != null) {
            for (String param : query.split("&")) {
                String[] pair = param.split("=");
                if (pair.length > 1) {
                    result.put(pair[0], URLDecoder.decode(pair[1], StandardCharsets.UTF_8));
                }
            }
        }
        return result;
    }

    private void sendXMLResponse(HttpExchange exchange, String xml) throws IOException {
        exchange.sendResponseHeaders(200, xml.getBytes().length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(xml.getBytes());
        }
    }

    private void sendErrorResponse(HttpExchange exchange, int code, String message) throws IOException {
        String response = "<error><code>" + code + "</code><message>" + message + "</message></error>";
        exchange.sendResponseHeaders(code, response.getBytes().length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(response.getBytes());
        }
    }

    public static void main(String[] args) {
        try {
            ChatServer server = new ChatServer();
            ChatInterface stub = (ChatInterface) UnicastRemoteObject.exportObject(server, 0);
            
            Registry registry = LocateRegistry.createRegistry(RMI_PORT);
            registry.rebind("ChatService", stub);
            
            server.startHttpServer();
            
            System.out.println("Servidor iniciado...");
            
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}