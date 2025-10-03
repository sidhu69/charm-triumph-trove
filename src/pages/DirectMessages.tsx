import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Search, Send, UserPlus, X, Check, XCircle } from "lucide-react";
import { BottomNavigation } from "@/components/BottomNavigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Friend {
  user_id: string;
  username: string;
  avatar_url: string;
  level: number;
  charms_total: number;
  display_name: string;
}

interface Message {
  id: string;
  content: string;
  sender_id: string;
  receiver_id: string;
  created_at: string;
  read_at: string | null;
}

const DirectMessages = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchUsername, setSearchUsername] = useState("");
  const [searchResult, setSearchResult] = useState<Friend | null>(null);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      fetchFriends();
      fetchPendingRequests();
    }
  }, [user]);

  useEffect(() => {
    if (selectedFriend) {
      fetchMessages();
      const channel = supabase
        .channel('direct-messages')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'direct_messages',
            filter: `sender_id=eq.${selectedFriend.user_id},receiver_id=eq.${user?.id}`
          },
          (payload) => {
            setMessages(prev => [...prev, payload.new as Message]);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [selectedFriend, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchFriends = async () => {
    if (!user) return;

    const { data: connections } = await supabase
      .from('user_connections')
      .select('friend_id')
      .eq('user_id', user.id)
      .eq('status', 'accepted');

    if (connections && connections.length > 0) {
      const { data: friendProfiles } = await supabase
        .from('profiles')
        .select('user_id, username, avatar_url, level, charms_total, display_name')
        .in('user_id', connections.map(c => c.friend_id));

      if (friendProfiles) {
        setFriends(friendProfiles as Friend[]);
      }
    }
  };

  const fetchPendingRequests = async () => {
    if (!user) return;

    const { data } = await supabase
      .from('user_connections')
      .select(`
        id,
        user_id,
        created_at,
        sender:profiles!user_connections_user_id_fkey(
          user_id,
          username,
          avatar_url,
          level
        )
      `)
      .eq('friend_id', user.id)
      .eq('status', 'pending');

    if (data) {
      setPendingRequests(data);
    }
  };

  const fetchMessages = async () => {
    if (!user || !selectedFriend) return;

    const { data } = await supabase
      .from('direct_messages')
      .select('*')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${selectedFriend.user_id}),and(sender_id.eq.${selectedFriend.user_id},receiver_id.eq.${user.id})`)
      .order('created_at', { ascending: true });

    if (data) {
      setMessages(data);
      
      // Mark messages as read
      await supabase
        .from('direct_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('receiver_id', user.id)
        .eq('sender_id', selectedFriend.user_id)
        .is('read_at', null);
    }
  };

  const sendMessage = async () => {
    if (!user || !selectedFriend || !newMessage.trim()) return;

    const { error } = await supabase
      .from('direct_messages')
      .insert({
        sender_id: user.id,
        receiver_id: selectedFriend.user_id,
        content: newMessage.trim(),
        message_type: 'text'
      });

    if (error) {
      toast({
        title: "Failed to send message",
        description: error.message,
        variant: "destructive"
      });
    } else {
      setNewMessage("");
      fetchMessages();
    }
  };

  const searchUser = async () => {
    if (!searchUsername.trim()) return;
    
    setLoading(true);
    const { data, error } = await supabase
      .rpc('get_user_by_username', { username_input: searchUsername.trim() });

    setLoading(false);

    if (error || !data || data.length === 0) {
      toast({
        title: "No results found",
        description: `No user found with username "${searchUsername}"`,
      });
      setSearchResult(null);
      return;
    }

    setSearchResult(data[0]);
  };

  const sendFriendRequest = async (friendId: string) => {
    if (!user) return;

    const { error } = await supabase
      .from('user_connections')
      .insert({
        user_id: user.id,
        friend_id: friendId,
        status: 'pending'
      });

    if (error) {
      toast({
        title: "Failed to send request",
        description: error.message,
        variant: "destructive"
      });
    } else {
      toast({
        title: "Friend request sent",
        description: "Wait for them to accept your request"
      });
      setShowAddFriend(false);
      setSearchResult(null);
      setSearchUsername("");
    }
  };

  const handleFriendRequest = async (requestId: string, accept: boolean) => {
    const { error } = await supabase
      .from('user_connections')
      .update({ status: accept ? 'accepted' : 'rejected' })
      .eq('id', requestId);

    if (!error) {
      toast({
        title: accept ? "Friend request accepted" : "Friend request rejected"
      });
      fetchPendingRequests();
      if (accept) fetchFriends();
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold gradient-text">Direct Messages</h1>
          <Button onClick={() => setShowAddFriend(true)} size="sm">
            <UserPlus className="h-4 w-4 mr-2" />
            Add Friend
          </Button>
        </div>

        {pendingRequests.length > 0 && (
          <Card className="p-4 mb-4 border-primary/50">
            <h3 className="font-semibold mb-3">Pending Requests</h3>
            {pendingRequests.map(req => (
              <div key={req.id} className="flex items-center justify-between mb-2 p-2 rounded bg-muted/30">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={req.sender.avatar_url} />
                    <AvatarFallback>{req.sender.username?.[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{req.sender.username}</p>
                    <p className="text-xs text-muted-foreground">wants to chat with you</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleFriendRequest(req.id, true)}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleFriendRequest(req.id, false)}>
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </Card>
        )}

        <div className="grid md:grid-cols-3 gap-4">
          <Card className="md:col-span-1 p-4">
            <h3 className="font-semibold mb-3">Friends</h3>
            {friends.length === 0 ? (
              <p className="text-sm text-muted-foreground">No friends yet. Add some!</p>
            ) : (
              <div className="space-y-2">
                {friends.map(friend => (
                  <div
                    key={friend.user_id}
                    onClick={() => setSelectedFriend(friend)}
                    className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                      selectedFriend?.user_id === friend.user_id ? 'bg-primary/20' : 'hover:bg-muted'
                    }`}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={friend.avatar_url} />
                      <AvatarFallback>{friend.username?.[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{friend.username}</p>
                      <p className="text-xs text-muted-foreground">Level {friend.level}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="md:col-span-2 p-4 flex flex-col h-[600px]">
            {selectedFriend ? (
              <>
                <div className="flex items-center gap-3 pb-3 border-b mb-4">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={selectedFriend.avatar_url} />
                    <AvatarFallback>{selectedFriend.username?.[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{selectedFriend.username}</p>
                    <p className="text-xs text-muted-foreground">Level {selectedFriend.level}</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto mb-4 space-y-3">
                  {messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.sender_id === user?.id ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[70%] px-4 py-2 rounded-2xl ${
                          msg.sender_id === user?.id
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}
                      >
                        <p>{msg.content}</p>
                        <p className="text-[10px] mt-1 opacity-70">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                <div className="flex gap-2">
                  <Input
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="Type a message..."
                    className="flex-1"
                  />
                  <Button onClick={sendMessage} size="icon">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Select a friend to start chatting
              </div>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={showAddFriend} onOpenChange={setShowAddFriend}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Friend</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={searchUsername}
                onChange={(e) => setSearchUsername(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchUser()}
                placeholder="Search by username..."
              />
              <Button onClick={searchUser} disabled={loading}>
                <Search className="h-4 w-4" />
              </Button>
            </div>

            {searchResult && (
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-16 w-16">
                      <AvatarImage src={searchResult.avatar_url} />
                      <AvatarFallback>{searchResult.username?.[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-lg">{searchResult.username}</p>
                      <p className="text-sm text-muted-foreground">Level {searchResult.level}</p>
                      <p className="text-xs text-muted-foreground">{searchResult.charms_total} charms</p>
                    </div>
                  </div>
                  <Button onClick={() => sendFriendRequest(searchResult.user_id)}>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Add Friend
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <BottomNavigation />
    </div>
  );
};

export default DirectMessages;
