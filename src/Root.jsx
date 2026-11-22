import { lazy, Suspense, useEffect } from "react";
import App from "./App.jsx";
import { useHashRoute } from "./router.js";

const FarmerPage = lazy(() => import("./farmer/FarmerPage.jsx"));

export default function Root() {
  const route = useHashRoute();

  useEffect(() => {
    document.title = route === "farmer" ? "Semicolon Acres" : "JS Playground";
  }, [route]);

  if (route === "farmer") {
    return (
      <Suspense
        fallback={
          <div className="h-screen bg-gray-950 text-gray-500 flex items-center justify-center">
            Loading farm…
          </div>
        }
      >
        <FarmerPage />
      </Suspense>
    );
  }
  return <App />;
}
