import { createFileRoute } from "@tanstack/react-router";
import { PuckoApp } from "../nima/pucko/PuckoApp";

export const Route = createFileRoute("/_chat/pucko")({ component: PuckoApp });
