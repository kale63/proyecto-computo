import java.rmi.Remote;
import java.rmi.RemoteException;
import java.util.List;

public interface ChatInterface extends Remote {
    void registerUser(String username) throws RemoteException;
    void unregisterUser(String username) throws RemoteException;
    
    void sendMessage(String from, String to, String message) throws RemoteException;
    void sendBroadcast(String from, String message) throws RemoteException;
    
    List<String> getMessages(String user1, String user2) throws RemoteException;
    List<String> getConnectedUsers() throws RemoteException;
}

