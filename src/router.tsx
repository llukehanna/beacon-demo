import { createBrowserRouter } from "react-router-dom";
import Titled from "@/Titled";
import Accuracy from "@/desk/Accuracy";
import Desk from "@/desk/Desk";
import Home from "@/desk/Home";
import MandatePage from "@/desk/MandatePage";
import Pipeline from "@/desk/Pipeline";
import Review from "@/desk/Review";
import Rules from "@/desk/Rules";
import SearchPage from "@/desk/SearchPage";

export const router = createBrowserRouter(
  [
    {
      // Start-of-day operations page. Every card and number on it links to
      // the surface that does the work; it is not a stats dashboard.
      path: "/",
      element: (
        <Titled title="Beacon — Home">
          <Home />
        </Titled>
      ),
    },
    {
      path: "/desk",
      element: (
        <Titled title="Beacon — Enrichment Desk">
          <Desk />
        </Titled>
      ),
    },
    {
      path: "/pipeline",
      element: (
        <Titled title="Beacon — Pipeline">
          <Pipeline />
        </Titled>
      ),
    },
    {
      path: "/review",
      element: (
        <Titled title="Beacon — Review">
          <Review />
        </Titled>
      ),
    },
    {
      path: "/rules",
      element: (
        <Titled title="Beacon — Rules">
          <Rules />
        </Titled>
      ),
    },
    {
      path: "/accuracy",
      element: (
        <Titled title="Beacon — Accuracy">
          <Accuracy />
        </Titled>
      ),
    },
    {
      path: "/mandate",
      element: (
        <Titled title="Beacon — Mandates">
          <MandatePage />
        </Titled>
      ),
    },
    {
      // "Interpret & run search" surface — turns a mandate's intent into
      // a Search (geographies / industries / seeds / exclusions / breadth
      // → the run-search action). Routes to /desk?search=<id> on completion.
      path: "/search/:mandateId",
      element: (
        <Titled title="Beacon — Run search">
          <SearchPage />
        </Titled>
      ),
    },
  ],
  { basename: import.meta.env.BASE_URL },
);
