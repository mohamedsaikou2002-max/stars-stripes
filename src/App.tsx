import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Briefs from "./pages/Briefs.tsx";
import ProfilePage from "./pages/Profile.tsx";
import HomePage from "./pages/Home.tsx";
import PodRoom from "./pages/PodRoom.tsx";
import EagleEye from "./pages/EagleEye.tsx";
import GameTheoryRoom from "./pages/GameTheoryRoom.tsx";

import Knowledge from "./pages/Knowledge";
import MiroFish from "./pages/MiroFish";
import { backendConfigured } from "./integrations/supabase/client";
import AuthGate from "./components/AuthGate";
import EagleView from "./pages/EagleView";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        {!backendConfigured && <div role="status" className="px-6 py-3 text-sm bg-blue-50 text-blue-950 border-b border-blue-100">Preview mode · Connect a dedicated backend to enable AI conversations and saved work.</div>}
        <Routes>
        <Route path="/eagle-view" element={<EagleView />} />
        <Route path="*" element={<AuthGate>
        <Routes>
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/swarm" element={<MiroFish />} />
          <Route path="/" element={<Index />} />
          <Route path="/briefs" element={<Briefs />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/pod-room" element={<PodRoom />} />
          <Route path="/eagle-eye" element={<EagleEye />} />
          <Route path="/game-theory" element={<GameTheoryRoom />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </AuthGate>} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
