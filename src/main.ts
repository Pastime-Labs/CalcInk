import "./style.css";
import { NotebookApp } from "./ui/app";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("CalcInk root element is missing");

void new NotebookApp(app).start();
