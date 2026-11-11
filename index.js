// Điểm vào của app. Tác vụ ghi vị trí nền phải được định nghĩa ngay khi JS khởi động
// (kể cả khi hệ điều hành đánh thức app ở chế độ nền), nên import trước expo-router.
import "./src/lib/tracking-task";
import "expo-router/entry";
