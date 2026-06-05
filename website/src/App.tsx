import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Install from "./pages/Install";
import Docs from "./pages/Docs";
import Usage from "./pages/Usage";
import Changelog from "./pages/Changelog";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/install" element={<Install />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/usage" element={<Usage />} />
        <Route path="/changelog" element={<Changelog />} />
      </Routes>
    </Layout>
  );
}
