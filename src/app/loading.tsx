import { Loader } from "@/components/beui/motion/loader";

export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/90 backdrop-blur-sm">
      <Loader variant="scramble" size={112} speed={1.6} label="正在加载" className="text-blue" />
    </div>
  );
}
