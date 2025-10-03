import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Plus, Send, Users, LogOut, User } from "lucide-react";
import { BottomNavigation } from "@/components/BottomNavigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Room {
  id: string;
  name: string;
  code: string;
  active_members: number;
  max_members: number;
  is_public: boolean;
}

interface RoomMessage {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
  sender?: {
    username: string;
    avatar_url: string;
    user_id: string;
    level: number;
  };
}

interface MemberActivity {
  user_id: string;
  username: string;
  joined: boolean;
}

const Rooms = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [showJoinRoom, setShowJoinRoom] = useState(false);
  const [memberActivities, setMemberActivities] = useState<MemberActivity[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      fetchRooms();
    }
  }, [user]);

  useEffect(() => {
    if (selectedRoom) {
      fetchMessages();
      joinRoom();

      // Real-time messages
      const messagesChannel = supabase
        .channel(`room-messages-${selectedRoom.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'room_messages',
            filter: `room_id=eq.${selectedRoom.id}`
          },
          async (payload) => {
            const newMsg = payload.new as RoomMessage;
            
            // Fetch sender profile
            const { data: profile } = await supabase
              .from('profiles')
              .select('username, avatar_url, user_id, level')
              .eq('user_id', newMsg.user_id)
              .single();
            
            setMessages(prev => [...prev, { ...newMsg, sender: profile }]);
          }
        )
        .subscribe();

      // Real-time member changes
      const membersChannel = supabase
        .channel(`room-members-${selectedRoom.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'room_members',
            filter: `room_id=eq.${selectedRoom.id}`
          },
          async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const member = payload.new;
              
            const memberData = member as any;
            if (memberData.is_active) {
              const { data: profile } = await supabase
                  .from('profiles')
                  .select('username')
                  .eq('user_id', memberData.user_id)
                  .single();
                
                if (profile && memberData.user_id !== user?.id) {
                  setMemberActivities(prev => [
                    ...prev,
                    { user_id: memberData.user_id, username: profile.username, joined: true }
                  ]);
                  
                  setTimeout(() => {
                    setMemberActivities(prev => prev.filter(m => m.user_id !== memberData.user_id || !m.joined));
                  }, 3000);
                }
              } else {
                const { data: profile } = await supabase
                  .from('profiles')
                  .select('username')
                  .eq('user_id', memberData.user_id)
                  .single();
                
                if (profile) {
                  setMemberActivities(prev => [
                    ...prev,
                    { user_id: memberData.user_id, username: profile.username, joined: false }
                  ]);
                  
                  setTimeout(() => {
                    setMemberActivities(prev => prev.filter(m => m.user_id !== memberData.user_id || m.joined));
                  }, 3000);
                }
              }
            }
            
            // Update room member count
            const newMember = payload.new as { is_active?: boolean };
            if ('is_active' in newMember && newMember.is_active !== undefined) {
              setSelectedRoom(prev => prev ? { 
                ...prev, 
                active_members: newMember.is_active ? prev.active_members + 1 : prev.active_members - 1 
              } : null);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(messagesChannel);
        supabase.removeChannel(membersChannel);
      };
    }
  }, [selectedRoom, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchRooms = async () => {
    if (!user) return;

    const { data } = await supabase
      .from('rooms')
      .select('*')
      .or(`is_public.eq.true,creator_id.eq.${user.id},id.in.(select room_id from room_members where user_id = '${user.id}' and is_active = true)`)
      .order('last_activity', { ascending: false });

    if (data) {
      setRooms(data);
    }
  };

  const fetchMessages = async () => {
    if (!selectedRoom) return;

    const { data: msgs } = await supabase
      .from('room_messages')
      .select('*')
      .eq('room_id', selectedRoom.id)
      .order('created_at', { ascending: true })
      .limit(100);

    if (msgs && msgs.length > 0) {
      const userIds = [...new Set(msgs.map(m => m.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, username, avatar_url, level')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]));
      
      setMessages(msgs.map(msg => ({
        ...msg,
        sender: profileMap.get(msg.user_id)
      })));
    } else {
      setMessages([]);
    }
  };

  const joinRoom = async () => {
    if (!user || !selectedRoom) return;

    // Check if already a member
    const { data: existingMember } = await supabase
      .from('room_members')
      .select('*')
      .eq('room_id', selectedRoom.id)
      .eq('user_id', user.id)
      .single();

    if (!existingMember) {
      await supabase
        .from('room_members')
        .insert({
          room_id: selectedRoom.id,
          user_id: user.id,
          is_active: true
        });
    } else if (!existingMember.is_active) {
      await supabase
        .from('room_members')
        .update({ is_active: true })
        .eq('id', existingMember.id);
    }
  };

  const leaveRoom = async () => {
    if (!user || !selectedRoom) return;

    await supabase
      .from('room_members')
      .update({ is_active: false })
      .eq('room_id', selectedRoom.id)
      .eq('user_id', user.id);

    setSelectedRoom(null);
    fetchRooms();
  };

  const sendMessage = async () => {
    if (!user || !selectedRoom || !newMessage.trim()) return;

    const { error } = await supabase
      .from('room_messages')
      .insert({
        room_id: selectedRoom.id,
        user_id: user.id,
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
    }
  };

  const createRoom = async () => {
    if (!user || !roomName.trim()) return;

    // Generate a 6-digit random code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const { error } = await supabase
      .from('rooms')
      .insert([{
        name: roomName.trim(),
        creator_id: user.id,
        is_public: true,
        code: code
      }]);

    if (error) {
      toast({
        title: "Failed to create room",
        description: error.message,
        variant: "destructive"
      });
    } else {
      toast({ title: "Room created successfully!" });
      setShowCreateRoom(false);
      setRoomName("");
      fetchRooms();
    }
  };

  const joinRoomByCode = async () => {
    if (!user || !roomCode.trim()) return;

    const { data: room } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', roomCode.trim())
      .single();

    if (!room) {
      toast({
        title: "Room not found",
        description: "No room with this code exists",
        variant: "destructive"
      });
      return;
    }

    if (room.active_members >= room.max_members) {
      toast({
        title: "Room is full",
        description: "This room has reached maximum capacity",
        variant: "destructive"
      });
      return;
    }

    setSelectedRoom(room);
    setShowJoinRoom(false);
    setRoomCode("");
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-6 max-w-5xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold gradient-text">Chat Rooms</h1>
          <div className="flex gap-2">
            <Button onClick={() => setShowJoinRoom(true)} size="sm" variant="outline">
              Join Room
            </Button>
            <Button onClick={() => setShowCreateRoom(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Create Room
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          <Card className="md:col-span-1 p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Users className="h-4 w-4" />
              Available Rooms
            </h3>
            {rooms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rooms available</p>
            ) : (
              <div className="space-y-2">
                {rooms.map(room => (
                  <div
                    key={room.id}
                    onClick={() => setSelectedRoom(room)}
                    className={`p-3 rounded cursor-pointer transition-colors ${
                      selectedRoom?.id === room.id ? 'bg-primary/20' : 'hover:bg-muted'
                    }`}
                  >
                    <p className="font-medium">{room.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {room.active_members}/{room.max_members} members
                    </p>
                    <p className="text-xs text-muted-foreground">Code: {room.code}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="md:col-span-3 p-4 flex flex-col h-[650px]">
            {selectedRoom ? (
              <>
                <div className="flex items-center justify-between pb-3 border-b mb-4">
                  <div>
                    <p className="font-semibold text-lg">{selectedRoom.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedRoom.active_members} members • Code: {selectedRoom.code}
                    </p>
                  </div>
                  <Button onClick={leaveRoom} variant="destructive" size="sm">
                    <LogOut className="h-4 w-4 mr-2" />
                    Leave
                  </Button>
                </div>

                {memberActivities.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {memberActivities.map((activity, idx) => (
                      <p key={idx} className="text-xs text-muted-foreground text-center py-1 animate-fade-in">
                        {activity.joined ? `${activity.username} joined the room` : `${activity.username} left the room`}
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex-1 overflow-y-auto mb-4 space-y-4">
                  {messages.map(msg => (
                    <div key={msg.id} className={`flex gap-3 ${msg.user_id === user?.id ? 'flex-row-reverse' : ''}`}>
                      <Avatar 
                        className="h-8 w-8 cursor-pointer hover:ring-2 ring-primary transition-all"
                        onClick={() => {
                          if (msg.sender) {
                            toast({
                              title: msg.sender.username,
                              description: `Level ${msg.sender.level}`
                            });
                          }
                        }}
                      >
                        <AvatarImage src={msg.sender?.avatar_url} />
                        <AvatarFallback>
                          <User className="h-4 w-4" />
                        </AvatarFallback>
                      </Avatar>
                      <div className={`flex flex-col ${msg.user_id === user?.id ? 'items-end' : 'items-start'}`}>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          {msg.user_id === user?.id ? 'You' : msg.sender?.username}
                        </p>
                        <div
                          className={`max-w-[400px] px-4 py-2 rounded-2xl ${
                            msg.user_id === user?.id
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted'
                          }`}
                        >
                          <p>{msg.content}</p>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
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
                Select a room to start chatting
              </div>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={showCreateRoom} onOpenChange={setShowCreateRoom}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Room</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Room name..."
            />
            <Button onClick={createRoom} className="w-full">
              Create Room
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showJoinRoom} onOpenChange={setShowJoinRoom}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join Room by Code</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              placeholder="Enter room code..."
            />
            <Button onClick={joinRoomByCode} className="w-full">
              Join Room
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BottomNavigation />
    </div>
  );
};

export default Rooms;
